/** @odoo-module **/

import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

patch(PosStore.prototype, {
    async _processData(loadedData) {
        await super._processData(...arguments);
        this.pci_card_brands = loadedData["pos.card.brand"] || [];
        this.pci_installment_plans = loadedData["pos.card.installment.plan"] || [];
    },
});
