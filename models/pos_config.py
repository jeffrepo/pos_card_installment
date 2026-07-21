from odoo import api, fields, models
import logging

_logger = logging.getLogger(__name__)


class PosConfig(models.Model):
    _inherit = "pos.config"

    pci_surcharge_product_id = fields.Many2one(
        "product.product",
        string="Producto de recargo financiero POS",
        domain=[("available_in_pos", "=", True)],
        help="Producto que el POS agregará como línea de recargo cuando se confirme tarjeta/cuotas.",
    )
    @api.model
    def _load_pos_data_read(self, records, config):
        read_records = super()._load_pos_data_read(records, config)
        if not read_records:
            return read_records

        for rec, values in zip(records, read_records):
            values["pci_surcharge_product_id"] = (
                [rec.pci_surcharge_product_id.id, rec.pci_surcharge_product_id.display_name]
                if rec.pci_surcharge_product_id
                else False
            )
        _logger.warning("PCI pos.config read_records: %s", read_records)
        return read_records
