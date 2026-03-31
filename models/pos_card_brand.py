from odoo import fields, models


class PosCardBrand(models.Model):
    _name = "pos.card.brand"
    _description = "POS Card Brand"
    _order = "name"

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        "res.company",
        required=True,
        default=lambda self: self.env.company,
        index=True,
    )

    _sql_constraints = [
        ("pos_card_brand_name_company_uniq", "unique(name, company_id)", "La tarjeta ya existe para esta compañía."),
    ]
