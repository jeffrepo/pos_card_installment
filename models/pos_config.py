from odoo import _, api, fields, models
from odoo.exceptions import ValidationError
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
    pci_rounding_product_id = fields.Many2one(
        "product.product",
        string="Producto de ajuste de redondeo POS",
        domain=[("available_in_pos", "=", True)],
        help=(
            "Producto sin impuestos que el POS usará para redondear el saldo pendiente "
            "únicamente cuando existan pagos con tarjeta/cuotas."
        ),
    )

    @api.constrains("pci_surcharge_product_id", "pci_rounding_product_id")
    def _check_pci_rounding_product(self):
        for config in self:
            rounding_product = config.pci_rounding_product_id
            if not rounding_product:
                continue
            if rounding_product == config.pci_surcharge_product_id:
                raise ValidationError(
                    _("El producto de redondeo debe ser distinto del producto de recargo financiero.")
                )
            if rounding_product.taxes_id:
                raise ValidationError(
                    _("El producto de ajuste de redondeo no debe tener impuestos de venta.")
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
            values["pci_rounding_product_id"] = (
                [rec.pci_rounding_product_id.id, rec.pci_rounding_product_id.display_name]
                if rec.pci_rounding_product_id
                else False
            )

        _logger.warning("PCI pos.config read_records: %s", read_records)
        return read_records
