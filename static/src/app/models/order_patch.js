/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Order } from "@point_of_sale/app/store/models";

patch(Order.prototype, {
    pci_total_surcharge() {
        return (this.payment_ids || []).reduce((sum, payment) => {
            return sum + (payment.pci_financing_surcharge || 0);
        }, 0);
    },
});
