/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";

function ceilMoney(value) {
    return Math.ceil(Number(value || 0));
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

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
        const netAmount = roundMoney(this.props.netAmount || 0);
        const coefficient = Number(firstInstallment?.surcharge_coefficient || 1);
        const financedTotal = roundMoney(netAmount * coefficient);
        const total = ceilMoney(financedTotal);
        const surcharge = roundMoney(financedTotal - netAmount);
        const rounding = roundMoney(total - financedTotal);

        this.state = useState({
            cards,
            selectedCardId: firstCard?.id || null,
            installments: firstInstallments,
            selectedInstallmentId: firstInstallment?.id || null,
            netAmount,
            coefficient,
            surcharge,
            rounding,
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
        this.state.netAmount = isNaN(value) ? 0 : roundMoney(value);
        this.recomputeAmounts();
    }

    recomputeAmounts() {
        const installment = this.selectedInstallment;
        const coefficient = Number(installment?.surcharge_coefficient || 1);
        const net = roundMoney(this.state.netAmount || 0);
        const financedTotal = roundMoney(net * coefficient);
        const total = ceilMoney(financedTotal);
        const surcharge = roundMoney(financedTotal - net);
        const rounding = roundMoney(total - financedTotal);

        this.state.netAmount = net;
        this.state.coefficient = coefficient;
        this.state.total = total;
        this.state.surcharge = surcharge;
        this.state.rounding = rounding;
    }

    buildPayload() {
        const net = roundMoney(this.state.netAmount);
        const financedTotal = roundMoney(net * Number(this.state.coefficient || 1));
        const total = ceilMoney(financedTotal);
        const surcharge = roundMoney(financedTotal - net);
        const rounding = roundMoney(total - financedTotal);

        return {
            confirmed: true,
            card_id: this.state.selectedCardId,
            installment_id: this.state.selectedInstallmentId,
            net_amount: net,
            surcharge_amount: surcharge,
            rounding_amount: rounding,
            total_amount: total,
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
