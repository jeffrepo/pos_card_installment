/** @odoo-module **/

import { Payment } from "@point_of_sale/app/store/models";
import { patch } from "@web/core/utils/patch";

patch(Payment.prototype, {
    setup() {
        super.setup(...arguments);
        this.pci_payment_method_label = this.pci_payment_method_label || null;
        this.pci_card_brand_id = this.pci_card_brand_id || null;
        this.pci_installment_plan_id = this.pci_installment_plan_id || null;
        this.pci_installments = this.pci_installments || 1;
        this.pci_net_amount = this.pci_net_amount || 0;
        this.pci_surcharge_amount = this.pci_surcharge_amount || 0;
        this.pci_total_amount = this.pci_total_amount || this.amount || 0;
    },

    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        json.pci_payment_method_label = this.pci_payment_method_label;
        json.pci_card_brand_id = this.pci_card_brand_id;
        json.pci_installment_plan_id = this.pci_installment_plan_id;
        json.pci_installments = this.pci_installments;
        json.pci_net_amount = this.pci_net_amount;
        json.pci_surcharge_amount = this.pci_surcharge_amount;
        json.pci_total_amount = this.pci_total_amount;
        return json;
    },

    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.pci_payment_method_label = json.pci_payment_method_label || null;
        this.pci_card_brand_id = json.pci_card_brand_id || null;
        this.pci_installment_plan_id = json.pci_installment_plan_id || null;
        this.pci_installments = json.pci_installments || 1;
        this.pci_net_amount = json.pci_net_amount || 0;
        this.pci_surcharge_amount = json.pci_surcharge_amount || 0;
        this.pci_total_amount = json.pci_total_amount || this.amount || 0;
    },

    setCardInstallmentData(payload) {
        this.pci_payment_method_label = payload.pci_payment_method_label || null;
        this.pci_card_brand_id = payload.pci_card_brand_id || null;
        this.pci_installment_plan_id = payload.pci_installment_plan_id || null;
        this.pci_installments = payload.pci_installments || 1;
        this.pci_net_amount = payload.pci_net_amount || 0;
        this.pci_surcharge_amount = payload.pci_surcharge_amount || 0;
        this.pci_total_amount = payload.pci_total_amount || payload.pci_net_amount || 0;
        if (typeof this.set_amount === "function") {
            this.set_amount(this.pci_total_amount);
        } else {
            this.amount = this.pci_total_amount;
        }
    },
});
