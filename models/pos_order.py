from odoo import Command, api, fields, models, _
from odoo.exceptions import UserError


class PosOrder(models.Model):
    _inherit = "pos.order"

    pci_surcharge_total = fields.Monetary(string="Recargo total", currency_field="currency_id", compute="_compute_pci_amounts", store=True)
    pci_net_total = fields.Monetary(string="Monto neto tarjetas", currency_field="currency_id", compute="_compute_pci_amounts", store=True)
    pci_debit_note_move_id = fields.Many2one("account.move", string="Nota de Débito")

    @api.depends("payment_ids.pci_surcharge_amount", "payment_ids.pci_net_amount")
    def _compute_pci_amounts(self):
        for order in self:
            order.pci_surcharge_total = sum(order.payment_ids.mapped("pci_surcharge_amount"))
            order.pci_net_total = sum(order.payment_ids.mapped("pci_net_amount"))


    def _payment_fields(self, order, ui_paymentline):
        res = super()._payment_fields(order, ui_paymentline)
        res.update({
            "pci_payment_method_label": ui_paymentline.get("pci_payment_method_label"),
            "pci_card_brand_id": ui_paymentline.get("pci_card_brand_id") or False,
            "pci_installment_plan_id": ui_paymentline.get("pci_installment_plan_id") or False,
            "pci_installments": ui_paymentline.get("pci_installments") or 1,
            "pci_net_amount": ui_paymentline.get("pci_net_amount") or ui_paymentline.get("amount") or 0.0,
            "pci_surcharge_amount": ui_paymentline.get("pci_surcharge_amount") or 0.0,
            "pci_total_amount": ui_paymentline.get("pci_total_amount") or ui_paymentline.get("amount") or 0.0,
        })
        return res

    def _process_saved_order(self, order):
        res = super()._process_saved_order(order)
        for pos_order in self:
            pos_order._pci_create_debit_note_if_needed()
        return res

    def _prepare_invoice_vals(self):
        vals = super()._prepare_invoice_vals()
        if self.pci_surcharge_total and not vals.get("invoice_origin"):
            vals["invoice_origin"] = self.name
        return vals

    def _pci_get_card_payments(self):
        self.ensure_one()
        return self.payment_ids.filtered(lambda p: p.pci_surcharge_amount > 0 and p.payment_method_id.pci_use_card_installment)

    def _pci_get_origin_invoice(self):
        self.ensure_one()
        if getattr(self, "account_move", False):
            return self.account_move
        if hasattr(self, "account_move_id") and self.account_move_id:
            return self.account_move_id
        return False

    def _pci_create_debit_note_if_needed(self):
        for order in self:
            if order.pci_debit_note_move_id or not order.pci_surcharge_total:
                continue
            invoice = order._pci_get_origin_invoice()
            if not invoice:
                continue

            first_payment = order._pci_get_card_payments()[:1]
            if not first_payment:
                continue

            payment_method = first_payment.payment_method_id
            if not payment_method.pci_journal_id:
                raise UserError(_("Configura el diario de Nota de Débito en el método de pago POS '%s'.") % payment_method.display_name)
            if not payment_method.pci_debit_note_product_id:
                raise UserError(_("Configura el producto de recargo en el método de pago POS '%s'.") % payment_method.display_name)
            if not payment_method.pci_document_type_id:
                raise UserError(_("Configura el tipo de comprobante ND en el método de pago POS '%s'.") % payment_method.display_name)

            line_name = _("Recargo financiero POS %s") % order.name
            debit_note_vals = {
                "move_type": "out_invoice",
                "partner_id": order.partner_id.id,
                "invoice_date": fields.Date.context_today(order),
                "invoice_origin": order.name,
                "journal_id": payment_method.pci_journal_id.id,
                "currency_id": order.currency_id.id,
                "invoice_user_id": order.user_id.id,
                "l10n_latam_document_type_id": payment_method.pci_document_type_id.id,
                "debit_origin_id": invoice.id,
                "invoice_line_ids": [
                    Command.create({
                        "product_id": payment_method.pci_debit_note_product_id.id,
                        "name": line_name,
                        "quantity": 1.0,
                        "price_unit": order.pci_surcharge_total,
                        "tax_ids": [Command.set(payment_method.pci_debit_note_product_id.taxes_id.filtered(lambda t: t.company_id == order.company_id).ids)],
                    })
                ],
            }
            debit_note = self.env["account.move"].with_company(order.company_id).create(debit_note_vals)
            debit_note.action_post()
            order.pci_debit_note_move_id = debit_note.id
