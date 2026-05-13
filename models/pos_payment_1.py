from odoo import api, fields, models
import logging

_logger = logging.getLogger(__name__)


class PosPayment(models.Model):
    _inherit = "pos.payment"

    card_id = fields.Many2one("account.card", string="Tarjeta")
    installment_id = fields.Many2one("account.card.installment", string="Plan de cuotas")

    net_amount = fields.Monetary(string="Monto neto")
    financing_surcharge = fields.Monetary(string="Recargo financiero")
    total_amount = fields.Monetary(string="Monto total")

    pci_debit_note_move_id = fields.Many2one(
        "account.move",
        string="Nota de débito generada",
        readonly=True,
        copy=False,
    )

    currency_id = fields.Many2one(related="pos_order_id.currency_id", store=True, readonly=True)

    @api.model
    def _load_pos_data_fields(self, config):
        fields_list = super()._load_pos_data_fields(config)
        extra_fields = [
            "card_id",
            "installment_id",
            "net_amount",
            "financing_surcharge",
            "total_amount",
            "pci_debit_note_move_id",
        ]
        for field_name in extra_fields:
            if field_name not in fields_list:
                fields_list.append(field_name)
        _logger.warning("PCI pos.payment _load_pos_data_fields: %s", fields_list)
        return fields_list


