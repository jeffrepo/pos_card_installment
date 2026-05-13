from odoo import _, fields, models
from odoo.exceptions import UserError


class PosOrder(models.Model):
    _inherit = "pos.order"


    def _create_pci_debit_note(self, invoice):
        self.ensure_one()

        # 🔥 obtener recargo desde payment lines
        surcharge = 0.0
        payment_line = None

        for line in self.payment_ids:
            if getattr(line, "pci_surcharge_amount", 0):
                surcharge = line.pci_surcharge_amount
                payment_line = line
                break

        if not surcharge:
            _logger.warning("PCI: no hay recargo, no se crea ND")
            return

        _logger.warning("PCI: creando ND por %s", surcharge)

        # 🔥 producto de recargo
        product = self.config_id.pci_surcharge_product_id

        if not product:
            _logger.warning("PCI: no hay producto de recargo configurado")
            return

        # 🔥 crear ND (account.move)
        debit_note = self.env["account.move"].create({
            "move_type": "out_invoice",  # luego lo convertimos a ND
            "partner_id": self.partner_id.id,
            "invoice_origin": self.name,
            "invoice_line_ids": [(0, 0, {
                "product_id": product.id,
                "name": "Recargo financiero",
                "quantity": 1,
                "price_unit": surcharge,
            })],
        })

        # 🔥 convertir en ND (depende de localización)
        if hasattr(debit_note, "_reverse_move_vals"):
            debit_note.write({"debit_origin_id": invoice.id})

        debit_note.action_post()

        _logger.warning("PCI: ND creada %s", debit_note.name)

        return debit_note

    def action_pos_order_invoice(self):
        res = super().action_pos_order_invoice()
    
        for order in self:
            logging.warning("before order.account_move")
            if order.account_move:
                logging.warning("action_pos_order_invoice")
                order._create_pci_debit_note(order.account_move)
    
        return res

    
    def _payment_fields(self, order, ui_paymentline):
        vals = super()._payment_fields(order, ui_paymentline)
        vals.update({
            "card_id": ui_paymentline.get("card_id") or False,
            "installment_id": ui_paymentline.get("installment_id") or False,
            "net_amount": ui_paymentline.get("net_amount") or ui_paymentline.get("amount") or 0.0,
        })
        return vals

    def _order_fields(self, ui_order):
        vals = super()._order_fields(ui_order)
        if any((p.get("financing_surcharge") or 0.0) > 0 for p in ui_order.get("statement_ids", [])):
            vals["to_invoice"] = True
        return vals

    def _generate_pos_order_invoice(self):
        moves = super()._generate_pos_order_invoice()
        for order in self:
            order._pci_create_financing_surcharge_notes()
        return moves

    def _pci_create_financing_surcharge_notes(self):
        for order in self:
            logging.warning("_pci_create_financing_surcharge_notes")
            logging.warning(order.account_move)
            if not order.account_move:
                continue
            surcharge_payments = order.payment_ids.filtered(
                lambda p: p.installment_id and p.financing_surcharge > 0 and not p.pci_debit_note_move_id
            )
            logging.warning(surcharge_payments)
            if not surcharge_payments:
                continue
            if not order.partner_id:
                raise UserError(_("A customer is required to generate the debit note for card installments."))
            if not order.to_invoice:
                raise UserError(_("The order must be invoiced in order to generate the debit note for card installments."))

            for payment in surcharge_payments:
                note = order._pci_create_debit_note_for_payment(payment)
                payment.pci_debit_note_move_id = note.id
                order._pci_reconcile_payment_extra_with_note(payment, note)


    
    def _pci_create_debit_note_for_payment(self, payment):
        self.ensure_one()
        product = self.company_id.product_surcharge_id
        if not product:
            raise UserError(
                _("To validate POS payments with installments you must configure the surcharge product on the company.")
            )

        journal = payment.payment_method_id.pci_debit_note_journal_id or self.config_id.invoice_journal_id
        if not journal:
            journal = self.env["account.journal"].search(
                [("type", "=", "sale"), ("company_id", "=", self.company_id.id)],
                limit=1,
            )
        if not journal:
            raise UserError(_("No sale journal was found to create the debit note."))

        move_type = "out_invoice"
        draft_move = self.env["account.move"].new({
            "move_type": move_type,
            "journal_id": journal.id,
            "partner_id": self.partner_id.id,
            "company_id": self.company_id.id,
        })
        document_types = draft_move.l10n_latam_available_document_type_ids.filtered(
            lambda x: x.internal_type == "debit_note"
        )
        document_type = document_types[:1] or draft_move.l10n_latam_document_type_id
        taxes = product.taxes_id.filtered(lambda t: t.company_id == self.company_id)
        untaxed_amount = self._pci_compute_untaxed_amount(payment.financing_surcharge, taxes)

        description_parts = [
            _("POS financing surcharge"),
            payment.payment_method_id.display_name,
        ]
        if payment.card_id:
            description_parts.append(payment.card_id.display_name)
        if payment.installment_id:
            description_parts.append(payment.installment_id.display_name)
        description = " - ".join([x for x in description_parts if x])

        note_vals = {
            "ref": f"{description} [{payment.uuid}]",
            "date": fields.Date.context_today(self),
            "invoice_date": fields.Date.context_today(self),
            "invoice_origin": self.name,
            "journal_id": journal.id,
            "invoice_user_id": self.user_id.id,
            "partner_id": self.partner_id.id,
            "move_type": move_type,
            "l10n_latam_document_type_id": document_type.id if document_type else False,
            "debit_origin_id": self.account_move.id,
            "invoice_line_ids": [
                (
                    0,
                    0,
                    {
                        "product_id": product.id,
                        "name": description,
                        "price_unit": untaxed_amount,
                        "tax_ids": [(6, 0, taxes.ids)],
                    },
                )
            ],
        }
        note = self.env["account.move"].create(note_vals)
        note.action_post()
        return note

    def _pci_compute_untaxed_amount(self, total_amount, taxes):
        self.ensure_one()
        taxes = taxes.filtered(lambda t: t.company_id == self.company_id)
        if not taxes:
            return total_amount
        return taxes.filtered(lambda t: not t.price_include).with_context(force_price_include=True).compute_all(
            total_amount, currency=self.currency_id
        )["total_excluded"]

    def _pci_reconcile_payment_extra_with_note(self, payment, note):
        self.ensure_one()
        if not payment.account_move_id:
            return
        payment_lines = payment.account_move_id.line_ids.filtered(
            lambda line: not line.reconciled
            and line.account_id.account_type == "asset_receivable"
            and line.partner_id.commercial_partner_id == self.partner_id.commercial_partner_id
        )
        note_lines = note.line_ids.filtered(
            lambda line: not line.reconciled and line.account_id.account_type == "asset_receivable"
        )
        if not payment_lines or not note_lines:
            return
        common_accounts = payment_lines.mapped("account_id") & note_lines.mapped("account_id")
        for account in common_accounts:
            (payment_lines.filtered(lambda l: l.account_id == account) +
             note_lines.filtered(lambda l: l.account_id == account)).reconcile()
