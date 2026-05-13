/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { CardInstallmentPopup } from "@pos_card_installment/app/popups/card_installment_popup";

function setPaymentAmount(line, amount) {
    const value = Number(amount || 0);
    if (typeof line?.setAmount === "function") {
        line.setAmount(value);
    } else if (typeof line?.set_amount === "function") {
        line.set_amount(value);
    } else {
        line.amount = value;
    }
}

function getOrderDue(order) {
    if (typeof order?.remainingDue !== "undefined") {
        return Number(order.remainingDue || 0);
    }
    if (typeof order?.getDue === "function") {
        return Number(order.getDue() || 0);
    }
    if (typeof order?.get_due === "function") {
        return Number(order.get_due() || 0);
    }
    return 0;
}

function getOrderTotal(order) {
    if (typeof order?.get_total_with_tax === "function") {
        return Number(order.get_total_with_tax() || 0);
    }
    if (typeof order?.getTotalWithTax === "function") {
        return Number(order.getTotalWithTax() || 0);
    }
    if (typeof order?.total_with_tax !== "undefined") {
        return Number(order.total_with_tax || 0);
    }
    if (typeof order?.totalDue !== "undefined") {
        return Number(order.totalDue || 0);
    }
    return 0;
}

function getLineAmount(line) {
    if (!line) {
        return 0;
    }
    if (typeof line.getAmount === "function") {
        return Number(line.getAmount() || 0);
    }
    return Number(line.amount || 0);
}

function normalizePopupPayload(result) {
    if (!result) {
        return null;
    }
    if (result.card_id || result.installment_id) {
        return result;
    }
    if (result.payload && (result.payload.card_id || result.payload.installment_id)) {
        return result.payload;
    }
    if (result.confirmed && result.payload) {
        return result.payload;
    }
    if (result.confirmed && (result.card_id || result.installment_id)) {
        return result;
    }
    return null;
}

function getSurchargeProductId(pos) {
    const configRecords = pos?.models?.["pos.config"]?.getAll?.() || [];

    const candidates = [
        pos?.config?.pci_surcharge_product_id,
        pos?.config?.data?.pci_surcharge_product_id,
        configRecords[0]?.pci_surcharge_product_id,
        configRecords[0]?.data?.pci_surcharge_product_id,
    ];

    console.log("PCI surcharge config candidates", candidates);

    const value = candidates.find((v) => v !== undefined && v !== null && v !== false);

    if (!value) {
        return null;
    }
    if (Array.isArray(value)) {
        return value[0] || null;
    }
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "object" && value.id) {
        return value.id;
    }
    return null;
}

function getSurchargeProduct(pos) {
    const productId = getSurchargeProductId(pos);
    if (!productId) {
        return null;
    }
    return (
        pos.models?.["product.product"]?.getBy?.("id", productId) ||
        pos.db?.get_product_by_id?.(productId) ||
        null
    );
}

function getOrderLines(order) {
    if (!order) {
        return [];
    }
    if (Array.isArray(order.lines)) {
        return order.lines;
    }
    if (order.lines?.models) {
        return order.lines.models;
    }
    if (typeof order.get_orderlines === "function") {
        return order.get_orderlines() || [];
    }
    return [];
}

function getLineProductId(line) {
    return (
        line?.product_id?.id ||
        line?.product?.id ||
        line?.getProduct?.()?.id ||
        null
    );
}

function findSurchargeLine(order, productId) {
    if (!productId) {
        return null;
    }
    const lines = getOrderLines(order);
    return lines.find((line) => getLineProductId(line) === productId) || null;
}

function setOrderlinePrice(line, amount) {
    const value = Number(amount || 0);
    if (!line) {
        return;
    }
    if (typeof line.set_unit_price === "function") {
        line.set_unit_price(value);
        return;
    }
    if (typeof line.setUnitPrice === "function") {
        line.setUnitPrice(value);
        return;
    }
    if (typeof line.price_unit !== "undefined") {
        line.price_unit = value;
    }
}

function setOrderlineQty(line, qty) {
    if (!line) {
        return;
    }
    if (typeof line.set_quantity === "function") {
        line.set_quantity(qty, true);
        return;
    }
    if (typeof line.setQuantity === "function") {
        line.setQuantity(qty, true);
        return;
    }
    if (typeof line.qty !== "undefined") {
        line.qty = qty;
    }
}

async function addProductToOrder(screen, product, price) {
    const order = screen.currentOrder;
    if (!order) {
        return null;
    }

    if (typeof screen.pos?.addLineToCurrentOrder === "function") {
        const line = await screen.pos.addLineToCurrentOrder(
            {
                product_id: product,
                product_tmpl_id: product.product_tmpl_id,
                qty: 1,
                price_unit: Number(price || 0),
            },
            {},
            false
        );
        return line;
    }

    if (typeof order.add_product === "function") {
        order.add_product(product, {
            quantity: 1,
            price: Number(price || 0),
            merge: false,
        });
        const lines = getOrderLines(order);
        return lines.length ? lines[lines.length - 1] : null;
    }

    return null;
}

async function upsertSurchargeLine(screen, order, surchargeAmount) {
    const productId = getSurchargeProductId(screen.pos);
    const product = getSurchargeProduct(screen.pos);

    console.log("PCI surcharge config raw", screen.pos?.config?.pci_surcharge_product_id);
    console.log("PCI surcharge productId", productId);
    console.log("PCI surcharge product found", product);

    if (!productId) {
        screen.dialog.add(AlertDialog, {
            title: _t("Falta configuración"),
            body: _t(
                "No se encontró el producto de recargo financiero configurado en el Punto de Venta."
            ),
        });
        return null;
    }

    if (!product) {
        screen.dialog.add(AlertDialog, {
            title: _t("Producto no cargado en POS"),
            body: _t(
                "El producto de recargo está configurado, pero no fue cargado en el Punto de Venta. Verifica que esté disponible en POS y visible para esta configuración."
            ),
        });
        return null;
    }

    let line = findSurchargeLine(order, productId);

    if (surchargeAmount > 0) {
        if (line) {
            setOrderlinePrice(line, surchargeAmount);
            setOrderlineQty(line, 1);
        } else {
            line = await addProductToOrder(screen, product, surchargeAmount);
        }
    } else if (line) {
        if (typeof order.removeOrderline === "function") {
            order.removeOrderline(line);
        } else if (typeof order.remove_orderline === "function") {
            order.remove_orderline(line);
        }
        line = null;
    }

    return line;
}

patch(PaymentScreen.prototype, {
    async addNewPaymentLine(paymentMethod) {
        const result = await super.addNewPaymentLine(...arguments);

        try {
            if (!result || !paymentMethod?.pci_use_installments) {
                return result;
            }

            const cards = paymentMethod.pci_card_data
                ? JSON.parse(paymentMethod.pci_card_data)
                : [];

            console.log("PCI parsed cards", cards);

            if (!cards.length) {
                return result;
            }

            const order = this.currentOrder;
            if (!order) {
                return result;
            }

            let paymentLine = this.selectedPaymentLine || order.getSelectedPaymentline();
            if (!paymentLine && order.payment_ids?.length) {
                paymentLine = order.payment_ids.at(-1);
            }
            if (!paymentLine) {
                return result;
            }

            const currentLineAmount = getLineAmount(paymentLine);
            const due = getOrderDue(order);
            const netAmount = currentLineAmount > 0 ? currentLineAmount : due;

            console.log("PCI order.payment_ids", order.payment_ids);
            console.log("PCI selected/fallback line", paymentLine);
            console.log("PCI netAmount used", { currentLineAmount, due, netAmount });

            const popupResult = await makeAwaitable(this.dialog, CardInstallmentPopup, {
                title: "Tarjeta / Cuotas",
                paymentMethod,
                netAmount,
            });

            console.log("PCI popupResult raw", popupResult);

            const payload = normalizePopupPayload(popupResult);

            console.log("PCI popup payload normalized", payload);

            if (!payload || !payload.card_id || !payload.installment_id) {
                if (typeof order.selectPaymentline === "function") {
                    order.selectPaymentline(paymentLine);
                }
                this.render(true);
                return result;
            }

            const {
                card_id,
                installment_id,
                net_amount,
                surcharge_amount,
                total_amount,
            } = payload;

            await upsertSurchargeLine(this, order, Number(surcharge_amount || 0));

            let activePaymentLine = this.selectedPaymentLine || order.getSelectedPaymentline();
            if (!activePaymentLine && order.payment_ids?.length) {
                activePaymentLine = order.payment_ids.at(-1);
            }

            if (!activePaymentLine) {
                console.warn("PCI: no se encontró payment line después de agregar recargo");
                this.render(true);
                return result;
            }

            const newTotal = getOrderTotal(order);

            setPaymentAmount(activePaymentLine, newTotal);

            activePaymentLine.pci_card_id = card_id;
            activePaymentLine.pci_installment_id = installment_id;
            activePaymentLine.pci_net_amount = Number(net_amount || 0);
            activePaymentLine.pci_surcharge_amount = Number(surcharge_amount || 0);
            activePaymentLine.pci_total_amount = Number(total_amount || 0);

            if (typeof order.selectPaymentline === "function") {
                order.selectPaymentline(activePaymentLine);
            }

            if (this.numberBuffer && typeof this.numberBuffer.reset === "function") {
                this.numberBuffer.reset();
            }
            if (this.numberBuffer && typeof this.numberBuffer.set === "function") {
                this.numberBuffer.set(String(newTotal));
            }

            console.log("PCI payment line final amount", newTotal);
            console.log("PCI activePaymentLine", activePaymentLine);

            this.render(true);
            return result;
        } catch (error) {
            console.error("PCI ERROR", error);
            return result;
        }
    },
});
