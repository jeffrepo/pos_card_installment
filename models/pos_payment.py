from odoo import api, fields, models


class PosPayment(models.Model):
    _inherit = "pos.payment"

    card_id = fields.Many2one("account.card", string="Tarjeta")
    installment_id = fields.Many2one("account.card.installment", string="Plan de cuotas")
    net_amount = fields.Monetary(string="Monto neto")
    financing_surcharge = fields.Monetary(
        string="Recargo financiero",
        compute="_compute_financing_surcharge",
        store=True,
    )
    pci_debit_note_move_id = fields.Many2one(
        "account.move",
        string="Nota de débito generada",
        readonly=True,
        copy=False,
    )

    @api.depends("amount", "net_amount")
    def _compute_financing_surcharge(self):
        for rec in self:
            net = rec.net_amount or 0.0
            rec.financing_surcharge = (rec.amount or 0.0) - net
