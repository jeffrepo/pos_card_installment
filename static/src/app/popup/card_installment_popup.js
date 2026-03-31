/** @odoo-module **/

import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { useState } from "@odoo/owl";

export class CardInstallmentPopup extends AbstractAwaitablePopup {
    static template = "pos_card_installment.CardInstallmentPopup";
    static defaultProps = {
        title: "Tarjeta y Cuotas",
        confirmText: "Aplicar",
        cancelText: "Cancelar",
        paymentMethod: null,
        amount: 0,
        defaultData: {},
        brands: [],
        plans: [],
    };

    setup() {
        super.setup();
        const defaults = this.props.defaultData || {};
        this.state = useState({
            payment_method_label: defaults.pci_payment_method_label || this.props.paymentMethod?.name || "",
            card_brand_id: defaults.pci_card_brand_id || this.props.paymentMethod?.pci_default_brand_id?.[0] || null,
            installment_plan_id: defaults.pci_installment_plan_id || null,
            installments: defaults.pci_installments || 1,
            net_amount: Number(defaults.pci_net_amount || this.props.amount || 0),
            surcharge_amount: Number(defaults.pci_surcharge_amount || 0),
            total_amount: Number(defaults.pci_total_amount || this.props.amount || 0),
        });
        this._recompute();
    }

    get brands() {
        return this.props.brands || [];
    }

    get plans() {
        return (this.props.plans || []).filter((plan) => {
            const methodOk = !plan.payment_method_ids?.length || plan.payment_method_ids.includes(this.props.paymentMethod?.id);
            const brandOk = !this.state.card_brand_id || plan.brand_id?.[0] === this.state.card_brand_id;
            return methodOk && brandOk;
        });
    }

    onChangeBrand(ev) {
        this.state.card_brand_id = Number(ev.target.value) || null;
        this.state.installment_plan_id = null;
        this.state.installments = 1;
        this._recompute();
    }

    onChangePlan(ev) {
        this.state.installment_plan_id = Number(ev.target.value) || null;
        const plan = this.plans.find((p) => p.id === this.state.installment_plan_id);
        this.state.installments = plan?.installments || 1;
        this._recompute();
    }

    onChangeNetAmount(ev) {
        this.state.net_amount = Number(ev.target.value || 0);
        this._recompute();
    }

    _recompute() {
        const plan = this.plans.find((p) => p.id === this.state.installment_plan_id);
        const percent = Number(plan?.surcharge_percent || 0);
        this.state.surcharge_amount = this.state.net_amount * percent / 100;
        this.state.total_amount = this.state.net_amount + this.state.surcharge_amount;
    }

    getPayload() {
        return {
            pci_payment_method_label: this.state.payment_method_label,
            pci_card_brand_id: this.state.card_brand_id,
            pci_installment_plan_id: this.state.installment_plan_id,
            pci_installments: this.state.installments,
            pci_net_amount: this.state.net_amount,
            pci_surcharge_amount: this.state.surcharge_amount,
            pci_total_amount: this.state.total_amount,
        };
    }
}
