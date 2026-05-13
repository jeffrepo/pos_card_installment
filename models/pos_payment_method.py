import json
from odoo import api, fields, models


class PosPaymentMethod(models.Model):
    _inherit = "pos.payment.method"

    pci_use_installments = fields.Boolean(
        string="Usar tarjeta/cuotas en POS",
        help="If enabled, the POS payment screen will ask for card, installment plan "
             "and net amount using the existing financing surcharge models."
    )
    pci_force_invoice = fields.Boolean(
        string="Forzar factura",
        default=True,
        help="When enabled, POS orders paid with this method will be invoiced automatically "
             "so the debit note can be linked to the generated invoice."
    )
    pci_payment_method_line_id = fields.Many2one(
        "account.payment.method.line",
        string="Línea de método de pago contable",
        help="Existing accounting payment method line used only as a source of available cards."
    )
    pci_debit_note_journal_id = fields.Many2one(
        "account.journal",
        string="Diario para nota de débito",
        domain=[("type", "=", "sale")],
        help="If empty, the POS invoice journal will be reused."
    )
    pci_card_data = fields.Text(
        string="Card payload for POS",
        compute="_compute_pci_card_data",
        compute_sudo=True,
    )

    @api.depends(
        "pci_use_installments",
        "pci_payment_method_line_id",
        "pci_payment_method_line_id.available_card_ids",
        "pci_payment_method_line_id.available_card_ids.installment_ids",
        "pci_payment_method_line_id.available_card_ids.installment_ids.surcharge_coefficient",
    )
    def _compute_pci_card_data(self):
        for rec in self:
            rec.pci_card_data = json.dumps(rec._pci_build_card_payload())

    def _pci_build_card_payload(self):
        self.ensure_one()
        payload = []
        if self.pci_use_installments and self.pci_payment_method_line_id:
            for card in self.pci_payment_method_line_id.available_card_ids:
                payload.append({
                    "id": card.id,
                    "name": card.display_name or card.name,
                    "installments": [
                        {
                            "id": inst.id,
                            "name": inst.display_name or inst.name,
                            "surcharge_coefficient": inst.surcharge_coefficient or 1.0,
                        }
                        for inst in card.installment_ids
                    ],
                })
        return payload

    @api.model
    def _load_pos_data_fields(self, config):
        fields_list = super()._load_pos_data_fields(config)
        extra = [
            "pci_use_installments",
            "pci_force_invoice",
            "pci_payment_method_line_id",
            "pci_debit_note_journal_id",
            "pci_card_data",
        ]
        for name in extra:
            if name not in fields_list:
                fields_list.append(name)
        return fields_list

    @api.model
    def _load_pos_data_read(self, records, config):
        data = super()._load_pos_data_read(records, config)
        record_map = {rec.id: rec for rec in records}
        for vals in data:
            rec = record_map.get(vals.get("id"))
            if rec:
                vals["pci_card_data"] = json.dumps(rec._pci_build_card_payload())
        return data