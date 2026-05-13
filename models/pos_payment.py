from odoo import fields, models


class PosPayment(models.Model):
    _inherit = "pos.payment"

    card_id = fields.Many2one("account.card", string="Tarjeta")
    installment_id = fields.Many2one("account.card.installment", string="Plan de cuotas")
    net_amount = fields.Monetary(string="Monto neto")
    financing_surcharge = fields.Monetary(string="Recargo financiero")
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
