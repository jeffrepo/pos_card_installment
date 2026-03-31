/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

export class CardInstallmentPopup extends Component {
    static template = "pos_card_installment.CardInstallmentPopup";
    static components = { Dialog };
    static props = {
        close: Function,
        title: { type: String, optional: true },
        paymentMethod: Object,
        netAmount: Number,
        currencySymbol: { type: String, optional: true },
    };

    setup() {
        const cards = this.props.paymentMethod.pci_card_data || [];
        const firstCard = cards.length ? cards[0] : null;
        const firstInstallment = firstCard && firstCard.installments.length ? firstCard.installments[0] : null;

        this.state = useState({
            cardId: firstCard ? firstCard.id : false,
            installmentId: firstInstallment ? firstInstallment.id : false,
            netAmount: this._round(this.props.netAmount || 0),
        });
    }

    get cards() {
        return this.props.paymentMethod.pci_card_data || [];
    }

    get selectedCard() {
        return this.cards.find((card) => card.id === this.state.cardId) || null;
    }

    get installments() {
        return this.selectedCard ? (this.selectedCard.installments || []) : [];
    }

    get selectedInstallment() {
        return this.installments.find((inst) => inst.id === this.state.installmentId) || null;
    }

    get surchargeCoefficient() {
        return this.selectedInstallment?.surcharge_coefficient || 1.0;
    }

    get totalAmount() {
        return this._round((this.state.netAmount || 0) * this.surchargeCoefficient);
    }

    get surchargeAmount() {
        return this._round(this.totalAmount - (this.state.netAmount || 0));
    }

    _round(value) {
        return Math.round((Number(value) || 0) * 100) / 100;
    }

    onCardChange(ev) {
        const cardId = Number(ev.target.value || 0) || false;
        this.state.cardId = cardId;
        const firstInstallment = this.installments.length ? this.installments[0] : false;
        this.state.installmentId = firstInstallment ? firstInstallment.id : false;
    }

    onInstallmentChange(ev) {
        this.state.installmentId = Number(ev.target.value || 0) || false;
    }

    onNetAmountInput(ev) {
        this.state.netAmount = this._round(ev.target.value);
    }

    cancel() {
        this.props.close({ confirmed: false });
    }

    confirm() {
        this.props.close({
            confirmed: true,
            payload: {
                card_id: this.state.cardId || false,
                installment_id: this.state.installmentId || false,
                net_amount: this._round(this.state.netAmount || 0),
                financing_surcharge: this.surchargeAmount,
                total_amount: this.totalAmount,
                card_name: this.selectedCard?.name || "",
                installment_name: this.selectedInstallment?.name || "",
            },
        });
    }
}
