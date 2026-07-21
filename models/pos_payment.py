from odoo import api, fields, models


class PosPayment(models.Model):
    _inherit = "pos.payment"

    card_id = fields.Many2one("account.card", string="Tarjeta")
    installment_id = fields.Many2one("account.card.installment", string="Plan de cuotas")
    pci_card_ref_id = fields.Integer(string="ID técnico de tarjeta PCI")
    pci_installment_ref_id = fields.Integer(string="ID técnico de cuota PCI")
    net_amount = fields.Monetary(string="Monto neto")
    financing_surcharge = fields.Monetary(string="Recargo financiero")
    rounding_adjustment = fields.Monetary(string="Ajuste de redondeo tarjeta/cuotas")
    pci_surcharge_amount = fields.Monetary(string="Recargo financiero PCI")
    total_amount = fields.Monetary(string="Monto total")
    pci_debit_note_move_id = fields.Many2one(
        "account.move",
        string="Nota de débito generada",
        readonly=True,
        copy=False,
    )

    currency_id = fields.Many2one(
        related="pos_order_id.currency_id",
        store=True,
        readonly=True,
    )

    @api.model
    def _normalize_pci_relation_vals(self, vals):
        normalized = dict(vals)
        if "pci_card_ref_id" in normalized and not normalized.get("card_id"):
            normalized["card_id"] = normalized["pci_card_ref_id"] or False
        if "pci_installment_ref_id" in normalized and not normalized.get("installment_id"):
            normalized["installment_id"] = normalized["pci_installment_ref_id"] or False
        return normalized

    @api.model_create_multi
    def create(self, vals_list):
        return super().create([
            self._normalize_pci_relation_vals(vals)
            for vals in vals_list
        ])

    def write(self, vals):
        return super().write(self._normalize_pci_relation_vals(vals))
