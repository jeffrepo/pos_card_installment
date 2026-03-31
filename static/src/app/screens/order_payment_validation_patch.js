/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { AlertDialog, ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import OrderPaymentValidation from "@point_of_sale/app/utils/order_payment_validation";
import { ask } from "@point_of_sale/app/utils/make_awaitable_dialog";

patch(OrderPaymentValidation.prototype, {
    _pciExtraAllowedAmount() {
        return this.paymentLines.reduce((sum, line) => sum + (line.pci_financing_surcharge || 0), 0);
    },

    async isOrderValid(isForceValidate) {
        if (this.order.isRefundInProcess()) {
            return false;
        }
        if (this.order.getOrderlines().length === 0 && this.order.isToInvoice()) {
            this.pos.dialog.add(AlertDialog, {
                title: _t("Empty Order"),
                body: _t("There must be at least one product in your order before it can be validated and invoiced."),
            });
            return false;
        }
        if ((this.order.isToInvoice() || this.order.getShippingDate()) && !this.order.getPartner()) {
            const confirmed = await ask(this.pos.dialog, {
                title: _t("Please select the Customer"),
                body: _t("You need to select the customer before you can invoice or ship an order."),
            });
            if (confirmed) {
                this.pos.selectPartner();
            }
            return false;
        }
        const partner = this.order.getPartner();
        if (this.order.getShippingDate() && !(partner.name && partner.street && partner.city && partner.country_id)) {
            this.pos.dialog.add(AlertDialog, {
                title: _t("Incorrect address for shipping"),
                body: _t("The selected customer needs an address."),
            });
            return false;
        }
        if (!this.order.presetRequirementsFilled) {
            const { field, message } = this.order.uiState.requiredPartnerDetails || {};
            this.pos.dialog.add(AlertDialog, {
                title: field ? _t("%s required", field) : _t("Missing required"),
                body: message || _t("Some required information is missing."),
            });
            return false;
        }
        if (!this.pos.currency.isZero(this.order.priceIncl) && this.order.payment_ids.length === 0) {
            this.pos.notification.add(_t("Select a payment method to validate the order."));
            return false;
        }
        if (!this.order.isPaid() || this.invoicing) {
            return false;
        }

        const extraAllowed = this._pciExtraAllowedAmount();
        const exactGap = Math.abs(this.order.priceIncl - this.order.amountPaid + this.order.appliedRounding);

        if (exactGap > 0.00001 && exactGap - extraAllowed > 0.00001) {
            if (!this.pos.models["pos.payment.method"].some((pm) => pm.is_cash_count)) {
                this.pos.dialog.add(AlertDialog, {
                    title: _t("Cannot return change without a cash payment method"),
                    body: _t(
                        "There is no cash payment method available in this point of sale to handle the change.\n\n"
                        + "Please pay the exact amount or add a cash payment method in the point of sale configuration"
                    ),
                });
                return false;
            }
        }

        const expectedOrderTotal = this.order.priceIncl + extraAllowed;
        if (!isForceValidate && expectedOrderTotal > 0 && expectedOrderTotal * 1000 < this.order.amountPaid) {
            this.pos.dialog.add(ConfirmationDialog, {
                title: _t("Please Confirm Large Amount"),
                body:
                    _t("Are you sure that the customer wants to pay") +
                    " " +
                    this.pos.env.utils.formatCurrency(this.order.amountPaid) +
                    " " +
                    _t("for an order of") +
                    " " +
                    this.pos.env.utils.formatCurrency(expectedOrderTotal) +
                    " " +
                    _t('? Clicking "Confirm" will validate the payment.'),
                confirm: () => this.validateOrder(true),
            });
            return false;
        }

        if (!this.order._isValidEmptyOrder()) {
            return false;
        }
        return true;
    },
});
