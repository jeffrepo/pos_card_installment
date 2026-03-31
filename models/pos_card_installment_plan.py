from odoo import api, fields, models
from odoo.exceptions import ValidationError


class PosCardInstallmentPlan(models.Model):
    _name = "pos.card.installment.plan"
    _description = "POS Card Installment Plan"
    _order = "brand_id, installments, surcharge_percent, name"

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        "res.company",
        required=True,
        default=lambda self: self.env.company,
        index=True,
    )
    brand_id = fields.Many2one("pos.card.brand", required=True, ondelete="cascade")
    payment_method_ids = fields.Many2many(
        "pos.payment.method",
        "pos_card_installment_plan_payment_method_rel",
        "plan_id",
        "payment_method_id",
        string="Métodos de Pago POS",
        help="Métodos de pago del POS a los que aplica este plan.",
    )
    installments = fields.Integer(string="Cuotas", required=True, default=1)
    surcharge_percent = fields.Float(string="Recargo %", digits=(16, 4), default=0.0)

    display_name_custom = fields.Char(compute="_compute_display_name_custom")

    @api.depends("name", "installments", "brand_id.name")
    def _compute_display_name_custom(self):
        for rec in self:
            rec.display_name_custom = rec.name or f"{rec.installments:02d} Cuotas ({rec.brand_id.name})"

    @api.constrains("installments")
    def _check_installments(self):
        for rec in self:
            if rec.installments < 1:
                raise ValidationError("La cantidad de cuotas debe ser mayor o igual a 1.")
