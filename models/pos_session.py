from odoo import models


class PosSession(models.Model):
    _inherit = "pos.session"

    def _load_pos_data_models(self, config_id):
        result = super()._load_pos_data_models(config_id)
        for model_name in ("pos.card.brand", "pos.card.installment.plan"):
            if model_name not in result:
                result.append(model_name)
        return result
