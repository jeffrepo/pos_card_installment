from odoo import fields, models


class PosPaymentMethod(models.Model):
    _inherit = "pos.payment.method"

    pci_use_card_installment = fields.Boolean(string="Usa tarjeta/cuotas en POS")
    pci_default_brand_id = fields.Many2one("pos.card.brand", string="Tarjeta por defecto")
    pci_journal_id = fields.Many2one(
        "account.journal",
        string="Diario Nota de Débito",
        domain="[('type', '=', 'sale'), ('company_id', '=', company_id)]",
        help="Diario usado para crear la ND del recargo financiero.",
    )
    pci_debit_note_product_id = fields.Many2one(
        "product.product",
        string="Producto para recargo",
        domain="[('sale_ok', '=', True)]",
        help="Producto usado en la línea de la ND para el recargo financiero.",
    )
    pci_document_type_id = fields.Many2one(
        "l10n_latam.document.type",
        string="Tipo comprobante ND",
        domain="[('country_id.code', '=', 'AR'), ('internal_type', '=', 'debit_note')]",
        help="Tipo de comprobante argentino para la nota de débito.",
    )

    def _load_pos_data_fields(self, config_id):
        fields_list = super()._load_pos_data_fields(config_id)
        return fields_list + [
            "pci_use_card_installment",
            "pci_default_brand_id",
            "pci_journal_id",
            "pci_debit_note_product_id",
            "pci_document_type_id",
        ]
