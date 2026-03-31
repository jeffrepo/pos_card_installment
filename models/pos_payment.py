from odoo import fields, models


class PosPayment(models.Model):
    _inherit = "pos.payment"

    pci_payment_method_label = fields.Char(string="Método de pago tarjeta")
    pci_card_brand_id = fields.Many2one("pos.card.brand", string="Tarjeta")
    pci_installment_plan_id = fields.Many2one("pos.card.installment.plan", string="Plan de cuotas")
    pci_installments = fields.Integer(string="Cuotas", default=1)
    pci_net_amount = fields.Monetary(string="Monto neto")
    pci_surcharge_amount = fields.Monetary(string="Recargo")
    pci_total_amount = fields.Monetary(string="Total con recargo")
