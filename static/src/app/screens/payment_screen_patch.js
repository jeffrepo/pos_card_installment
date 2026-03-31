/** @odoo-module **/

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { makeAwaitable } from "@point_of_sale/app/store/make_awaitable_dialog";
import { CardInstallmentPopup } from "../popup/card_installment_popup";

patch(PaymentScreen.prototype, {
    get pciCurrentPaymentLine() {
        return this.currentOrder?.selected_paymentline || this.currentOrder?.get_selected_paymentline?.() || null;
    },

    get pciCurrentLineCardBrandName() {
        const line = this.pciCurrentPaymentLine;
        const brand = this.pos.pci_card_brands?.find((b) => b.id === line?.pci_card_brand_id);
        return brand?.name || "";
    },

    get pciCurrentLinePlanName() {
        const line = this.pciCurrentPaymentLine;
        const plan = this.pos.pci_installment_plans?.find((p) => p.id === line?.pci_installment_plan_id);
        return plan?.name || "";
    },

    async addNewPaymentLine(paymentMethod) {
        const result = await super.addNewPaymentLine(...arguments);
        if (!result) {
            return result;
        }
        if (paymentMethod?.pci_use_card_installment) {
            await this.pciOpenInstallmentPopup();
        }
        return result;
    },

    async pciOpenInstallmentPopup() {
        const line = this.pciCurrentPaymentLine;
        if (!line || !line.payment_method?.pci_use_card_installment) {
            return;
        }
        const payload = await makeAwaitable(this.dialog, CardInstallmentPopup, {
            title: "Tarjeta y Cuotas",
            paymentMethod: line.payment_method,
            amount: line.amount || this.currentOrder.get_due(),
            defaultData: {
                pci_payment_method_label: line.pci_payment_method_label,
                pci_card_brand_id: line.pci_card_brand_id,
                pci_installment_plan_id: line.pci_installment_plan_id,
                pci_installments: line.pci_installments,
                pci_net_amount: line.pci_net_amount || line.amount || this.currentOrder.get_due(),
                pci_surcharge_amount: line.pci_surcharge_amount,
                pci_total_amount: line.pci_total_amount || line.amount || this.currentOrder.get_due(),
            },
            brands: this.pos.pci_card_brands || [],
            plans: this.pos.pci_installment_plans || [],
        });
        if (payload) {
            line.setCardInstallmentData(payload);
            this.render();
        }
    },

    async validateOrder(isForceValidate) {
        const cardLines = this.currentOrder.paymentlines.filter((line) => line.payment_method?.pci_use_card_installment);
        for (const line of cardLines) {
            if (!line.pci_card_brand_id || !line.pci_installment_plan_id) {
                await this.pciOpenInstallmentPopup();
                break;
            }
        }
        return super.validateOrder(isForceValidate);
    },
});
