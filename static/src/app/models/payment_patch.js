/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Payment } from "@point_of_sale/app/store/models";

patch(Payment.prototype, {
    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.card_id = json.card_id || false;
        this.installment_id = json.installment_id || false;
        this.net_amount = json.net_amount || 0;
        this.pci_financing_surcharge = json.financing_surcharge || 0;
        this.pci_card_name = json.pci_card_name || "";
        this.pci_installment_name = json.pci_installment_name || "";
    },

    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        json.card_id = this.card_id || false;
        json.installment_id = this.installment_id || false;
        json.net_amount = this.net_amount || 0;
        json.financing_surcharge = this.pci_financing_surcharge || 0;
        json.pci_card_name = this.pci_card_name || "";
        json.pci_installment_name = this.pci_installment_name || "";
        return json;
    },

    export_for_printing() {
        const data = super.export_for_printing(...arguments);
        data.card_name = this.pci_card_name || "";
        data.installment_name = this.pci_installment_name || "";
        data.net_amount = this.net_amount || 0;
        data.financing_surcharge = this.pci_financing_surcharge || 0;
        return data;
    },
});
