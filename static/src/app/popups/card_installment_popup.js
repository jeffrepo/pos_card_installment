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
        getPayload: { type: Function, optional: true },
    };

    setup() {
        let cards = [];
        try {
            const raw = this.props.paymentMethod?.pci_card_data;
            if (Array.isArray(raw)) {
                cards = raw;
            } else if (typeof raw === "string" && raw.trim()) {
                cards = JSON.parse(raw);
            }
        } catch (error) {
            console.error("PCI popup parse error", error);
        }

        console.log("PCI POPUP cards", cards);

        const firstCard = cards.length ? cards[0] : null;
        const firstInstallments = firstCard?.installments || [];
        const firstInstallment = firstInstallments.length ? firstInstallments[0] : null;
        const netAmount = Number(this.props.netAmount || 0);
        const coefficient = Number(firstInstallment?.surcharge_coefficient || 1);
        const total = netAmount * coefficient;
        const surcharge = total - netAmount;

        this.state = useState({
            cards,
            selectedCardId: firstCard?.id || null,
            installments: firstInstallments,
            selectedInstallmentId: firstInstallment?.id || null,
            netAmount,
            coefficient,
            surcharge,
            total,
        });
    }

    get selectedInstallment() {
        return (
            this.state.installments.find(
                (i) => i.id === this.state.selectedInstallmentId
            ) || null
        );
    }

    onChangeCard(ev) {
        const cardId = parseInt(ev.target.value, 10) || null;
        const card = this.state.cards.find((c) => c.id === cardId) || null;
        const installments = card?.installments || [];
        const firstInstallment = installments.length ? installments[0] : null;

        this.state.selectedCardId = cardId;
        this.state.installments = installments;
        this.state.selectedInstallmentId = firstInstallment?.id || null;

        this.recomputeAmounts();
    }

    onChangeInstallment(ev) {
        this.state.selectedInstallmentId = parseInt(ev.target.value, 10) || null;
        this.recomputeAmounts();
    }

    onChangeNetAmount(ev) {
        const value = parseFloat(ev.target.value || 0);
        this.state.netAmount = isNaN(value) ? 0 : value;
        this.recomputeAmounts();
    }

    recomputeAmounts() {
        const installment = this.selectedInstallment;
        const coefficient = Number(installment?.surcharge_coefficient || 1);
        const net = Number(this.state.netAmount || 0);
        const total = net * coefficient;
        const surcharge = total - net;

        this.state.coefficient = coefficient;
        this.state.total = total;
        this.state.surcharge = surcharge;
    }

    buildPayload() {
        return {
            confirmed: true,
            card_id: this.state.selectedCardId,
            installment_id: this.state.selectedInstallmentId,
            net_amount: this.state.netAmount,
            surcharge_amount: this.state.surcharge,
            total_amount: this.state.total,
        };
    }

    confirm() {
        if (!this.state.selectedCardId || !this.state.selectedInstallmentId) {
            return;
        }

        const payload = this.buildPayload();
        console.log("PCI popup confirm payload", payload);

        // 👇 ESTA ES LA PARTE CLAVE
        if (typeof this.props.getPayload === "function") {
            this.props.getPayload(payload);
        }

        this.props.close();
    }

    cancel() {
        this.props.close();
    }
}