import logging

from odoo import _, api, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class PosOrder(models.Model):
    _inherit = "pos.order"

    @api.model
    def _process_order(self, order, existing_order):
        installment_method_ids = {
            command[2].get("payment_method_id")
            for command in order.get("payment_ids", [])
            if isinstance(command, (list, tuple))
            and len(command) >= 3
            and command[2]
            and (
                command[2].get("installment_id")
                or command[2].get("pci_installment_ref_id")
            )
            and command[2].get("payment_method_id")
        }
        if installment_method_ids:
            force_invoice = self.env["pos.payment.method"].browse(
                installment_method_ids
            ).filtered("pci_force_invoice")
            if force_invoice:
                order["to_invoice"] = True

        return super()._process_order(order, existing_order)

    def _has_pci_installment_payment(self):
        self.ensure_one()
        return any(
            payment.installment_id or payment.pci_installment_ref_id
            for payment in self.payment_ids
        )

    def _get_pci_surcharge_line(self):
        self.ensure_one()
        if not self._has_pci_installment_payment():
            return self.env["pos.order.line"]

        product = self.config_id.pci_surcharge_product_id
        if not product:
            return self.env["pos.order.line"]

        return self.lines.filtered(lambda l: l.product_id.id == product.id)[:1]

    def _get_pci_rounding_line(self):
        self.ensure_one()
        if not self._has_pci_installment_payment():
            return self.env["pos.order.line"]

        product = self.config_id.pci_rounding_product_id
        if not product:
            return self.env["pos.order.line"]

        return self.lines.filtered(lambda l: l.product_id.id == product.id)[:1]

    def _prepare_pci_debit_note_vals_from_lines(self, invoice, financial_lines):
        self.ensure_one()

        partner = invoice.partner_id or self.partner_id
        if not partner:
            raise UserError(_("La orden POS debe tener cliente para generar la nota de débito automática."))

        invoice_line_ids = []
        for line in financial_lines:
            invoice_line_ids.append((0, 0, {
                "product_id": line.product_id.id,
                "name": line.full_product_name or line.product_id.display_name or _("Ajuste tarjeta/cuotas"),
                "quantity": line.qty or 1.0,
                "price_unit": line.price_unit,
                "discount": line.discount or 0.0,
                "tax_ids": [(6, 0, line.tax_ids.ids)],
            }))

        installment_payment = self.payment_ids.filtered(
            lambda payment: payment.installment_id or payment.pci_installment_ref_id
        )[:1]
        debit_note_journal = (
            installment_payment.payment_method_id.pci_debit_note_journal_id
            or invoice.journal_id
        )

        vals = {
            "move_type": "out_invoice",
            "partner_id": partner.id,
            "journal_id": debit_note_journal.id,
            "currency_id": invoice.currency_id.id,
            "invoice_date": invoice.invoice_date,
            "invoice_origin": invoice.name or self.pos_reference or self.name,
            "ref": _("Recargo financiero POS - %s", self.pos_reference or self.name),
            "invoice_payment_term_id": False,
            "invoice_line_ids": invoice_line_ids,
        }

        # Reutilizar datos latam si existen en la factura original
        for field_name in [
            "l10n_latam_document_type_id",
            "l10n_latam_available_document_type_ids",
        ]:
            if field_name in invoice._fields and field_name in self.env["account.move"]._fields:
                try:
                    value = invoice[field_name]
                    if value:
                        vals[field_name] = value.id if hasattr(value, "id") else value
                except Exception:
                    pass

        return vals

    def _create_pci_debit_note(self, invoice):
        self.ensure_one()

        if not self._has_pci_installment_payment():
            return self.env["account.move"]

        surcharge_line = self._get_pci_surcharge_line()
        rounding_line = self._get_pci_rounding_line()
        financial_lines = surcharge_line | rounding_line
        if not financial_lines:
            _logger.warning("PCI ND: orden %s sin líneas de recargo o redondeo", self.name)
            return self.env["account.move"]

        # Evitar duplicados si el método se dispara más de una vez
        existing = self.env["account.move"].search([
            ("move_type", "=", "out_invoice"),
            ("partner_id", "=", invoice.partner_id.id),
            ("invoice_origin", "=", invoice.name or self.pos_reference or self.name),
            ("ref", "=", _("Recargo financiero POS - %s", self.pos_reference or self.name)),
            ("state", "!=", "cancel"),
        ], limit=1)
        if existing:
            _logger.warning("PCI ND: orden %s ya tiene ND %s", self.name, existing.name)
            return existing

        _logger.warning(
            "PCI ND: creando ND desde líneas financieras. order=%s lines=%s total_incl=%s",
            self.name,
            financial_lines.ids,
            sum(financial_lines.mapped("price_subtotal_incl")),
        )

        vals = self._prepare_pci_debit_note_vals_from_lines(invoice, financial_lines)
        debit_note = self.env["account.move"].sudo().with_company(self.company_id).create(vals)
        document_type = self.env["l10n_latam.document.type"].search([("code", "=", "7")], limit=1)
        if document_type:
            debit_note.write({"l10n_latam_document_type_id": document_type.id})
        debit_note.action_post()

        # Guardar referencia en los pagos de la orden
        if "pci_debit_note_move_id" in self.payment_ids._fields:
            self.payment_ids.write({"pci_debit_note_move_id": debit_note.id})

        _logger.warning("PCI ND: ND creada %s para orden %s", debit_note.name, self.name)
        return debit_note

    def _reconcile_pci_debit_note_with_payment(self, debit_note):
        self.ensure_one()
        if not debit_note:
            return

        payment_move_lines = self.payment_ids.mapped("account_move_id.line_ids")
        if not payment_move_lines:
            _logger.warning("PCI ND: orden %s sin account_move_id en pagos", self.name)
            return

        receivable_account = self.partner_id.commercial_partner_id.property_account_receivable_id
        if not receivable_account or not receivable_account.reconcile:
            _logger.warning("PCI ND: cuenta por cobrar no conciliable para orden %s", self.name)
            return

        payment_receivable = payment_move_lines.filtered(
            lambda l: l.account_id == receivable_account and not l.reconciled
        )
        note_receivable = debit_note.line_ids.filtered(
            lambda l: l.account_id == receivable_account and not l.reconciled
        )

        _logger.warning(
            "PCI ND: reconcile candidates order=%s payment_lines=%s note_lines=%s",
            self.name,
            payment_receivable.ids,
            note_receivable.ids,
        )

        if payment_receivable and note_receivable:
            (payment_receivable | note_receivable).sudo().with_company(self.company_id).reconcile()
            _logger.warning("PCI ND: ND %s conciliada con pago de orden %s", debit_note.name, self.name)

    def _generate_pos_order_invoice(self):
        invoice = super()._generate_pos_order_invoice()

        for order in self:
            try:
                _logger.warning(
                    "PCI DEBUG order %s payments RAW: %s",
                    order.name,
                    order.payment_ids.read([
                        "amount",
                        "card_id",
                        "installment_id",
                        "pci_card_ref_id",
                        "pci_installment_ref_id",
                        "net_amount",
                        "financing_surcharge",
                        "rounding_adjustment",
                        "total_amount",
                    ]),
                )
                _logger.warning(
                    "PCI DEBUG order %s financial lines: %s",
                    order.name,
                    order.lines.filtered(
                        lambda line: line.product_id in (
                            order.config_id.pci_surcharge_product_id
                            | order.config_id.pci_rounding_product_id
                        )
                    ).read([
                        "product_id",
                        "price_unit",
                        "qty",
                        "price_subtotal",
                        "price_subtotal_incl",
                    ]),
                )

                debit_note = order._create_pci_debit_note(invoice)
                order._reconcile_pci_debit_note_with_payment(debit_note)
            except Exception:
                _logger.exception("PCI ND: error generando ND para orden %s", order.name)

        return invoice


    def _get_pci_surcharge_product(self):
        self.ensure_one()
        return self.config_id.pci_surcharge_product_id

    def _prepare_invoice_lines(self, move_type):
        invoice_lines = super()._prepare_invoice_lines(move_type)

        if not self:
            return invoice_lines

        order = self[0]
        if not order._has_pci_installment_payment():
            return invoice_lines

        financial_products = (
            order.config_id.pci_surcharge_product_id
            | order.config_id.pci_rounding_product_id
        )
        financial_product_ids = set(financial_products.ids)
        if not financial_product_ids:
            return invoice_lines

        filtered_lines = []
        for command in invoice_lines:
            if not isinstance(command, (list, tuple)) or len(command) < 3:
                filtered_lines.append(command)
                continue

            vals = command[2] or {}
            product_id = vals.get("product_id")

            # El recargo y su redondeo se facturan en la nota de débito, no en la factura base.
            if product_id in financial_product_ids:
                _logger.warning(
                    "PCI ND: excluyendo producto financiero %s de invoice_line_ids",
                    product_id,
                )
                continue

            filtered_lines.append(command)

        return filtered_lines
