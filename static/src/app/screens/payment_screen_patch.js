/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { CardInstallmentPopup } from "@pos_card_installment/app/popups/card_installment_popup";

function setPaymentAmount(line, amount) {
    if (typeof line.setAmount === "function") {
        line.setAmount(amount);
    } else if (typeof line.set_amount === "function") {
        line.set_amount(amount);
    } else {
        line.amount = amount;
    }
}

patch(PaymentScreen.prototype, {
    async addNewPaymentLine(paymentMethod) {
        await super.addNewPaymentLine(...arguments);

        const order = this.currentOrder;
        const line = order?.selected_paymentline || order?.payment_ids?.at(-1);
        if (!line || !paymentMethod?.pci_use_installments) {
            return;
        }

        const cards = paymentMethod.pci_card_data || [];
        if (!cards.length) {
            this.dialog.add(AlertDialog, {
                title: _t("No cards configured"),
                body: _t("This payment method has installments enabled but no cards are configured on the linked accounting payment method line."),
            });
            order.removePaymentline(line);
            return;
        }

        const baseNet = Math.max(order.getDue() || 0, 0);
        const result = await makeAwaitable(this.dialog, CardInstallmentPopup, {
            title: _t("Tarjeta y cuotas"),
            paymentMethod,
            netAmount: baseNet,
        });

        if (!result?.confirmed) {
            order.removePaymentline(line);
            return;
        }

        const payload = result.payload;
        line.card_id = payload.card_id;
        line.installment_id = payload.installment_id;
        line.net_amount = payload.net_amount;
        line.financing_surcharge = payload.financing_surcharge;
        line.pci_card_name = payload.card_name;
        line.pci_installment_name = payload.installment_name;
        setPaymentAmount(line, payload.total_amount);

        const origExport = line.export_as_JSON ? line.export_as_JSON.bind(line) : null;
        if (origExport && !line._pciWrappedExport) {
            line.export_as_JSON = function () {
                const json = origExport();
                json.card_id = this.card_id || false;
                json.installment_id = this.installment_id || false;
                json.net_amount = this.net_amount || 0;
                json.financing_surcharge = this.financing_surcharge || 0;
                json.pci_card_name = this.pci_card_name || "";
                json.pci_installment_name = this.pci_installment_name || "";
                return json;
            };
            line._pciWrappedExport = true;
        }

        if (paymentMethod.pci_force_invoice && typeof order.setToInvoice === "function") {
            order.setToInvoice(true);
        }
    },
});
