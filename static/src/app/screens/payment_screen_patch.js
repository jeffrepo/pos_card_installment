/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { makeAwaitable } from "@point_of_sale/app/utils/make_awaitable_dialog";
import { CardInstallmentPopup } from "@pos_card_installment/app/popups/card_installment_popup";

function ceilMoney(value) {
    return Math.ceil(Number(value || 0));
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function roundPrice(value) {
    return Math.round(Number(value || 0) * 1000000) / 1000000;
}

function setPaymentAmount(line, amount) {
    const value = roundMoney(amount);
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
    if (typeof line?.product_id === "number") {
        return line.product_id;
    }
    if (typeof line?.product === "number") {
        return line.product;
    }
    return (
        line?.product_id?.id ||
        line?.product?.id ||
        line?.getProduct?.()?.id ||
        null
    );
}

function findProductLine(order, productId) {
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

    if (typeof line.setUnitPrice === "function") {
        line.setUnitPrice(value);
        return;
    }

    if (typeof line.set_unit_price === "function") {
        line.set_unit_price(value);
        return;
    }

    console.warn("PCI: no se encontró método seguro para setear precio de línea", line);
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

function setOrderlineDiscount(line, discount) {
    if (!line) {
        return;
    }

    const value = Math.max(0, Math.min(100, Number(discount || 0)));
    if (typeof line.setDiscount === "function") {
        line.setDiscount(value);
    } else if (typeof line.set_discount === "function") {
        line.set_discount(value);
    } else {
        line.discount = value;
    }
}

function getTotalCardAdjustment(order) {
    const payments = order?.payment_ids || [];
    return roundMoney(payments.reduce((total, payment) => {
        if (!payment.installment_id && !payment.pci_installment_ref_id) {
            return total;
        }
        return (
            total +
            Number(payment.financing_surcharge || 0) +
            Number(payment.rounding_adjustment || 0)
        );
    }, 0));
}

function removeOrderline(order, line) {
    if (!line) {
        return;
    }
    if (typeof order.removeOrderline === "function") {
        order.removeOrderline(line);
    } else if (typeof order.remove_orderline === "function") {
        order.remove_orderline(line);
    } else if (typeof line.delete === "function") {
        line.delete();
    }
}

async function getCachedConfiguredProduct(screen, fieldName, cacheName, label) {
    if (screen.pos[cacheName]) {
        return screen.pos[cacheName];
    }

    const orm = screen.env.services.orm;
    const configId = screen.pos?.config?.id;

    if (!orm || !configId) {
        return null;
    }

    const configData = await orm.read(
        "pos.config",
        [configId],
        [fieldName]
    );

    const raw = configData?.[0]?.[fieldName];
    console.log(`PCI ${label} config via RPC`, raw);

    let productId = null;
    if (Array.isArray(raw)) {
        productId = raw[0] || null;
    } else if (typeof raw === "number") {
        productId = raw;
    } else if (raw && typeof raw === "object" && raw.id) {
        productId = raw.id;
    }

    if (!productId) {
        return null;
    }

    const products = await orm.read(
        "product.product",
        [productId],
        ["id", "display_name", "product_tmpl_id", "available_in_pos", "sale_ok", "taxes_id"]
    );

    const product = products?.[0] || null;
    console.log(`PCI ${label} product via RPC`, product);

    if (product) {
        screen.pos[cacheName] = product;
    }

    return product;
}

async function getCachedSurchargeProduct(screen) {
    return getCachedConfiguredProduct(
        screen,
        "pci_surcharge_product_id",
        "pci_surcharge_product_cache",
        "surcharge"
    );
}

async function addProductToOrder(screen, productData, price) {
    const pos = screen.pos;

    if (!productData?.id) {
        return null;
    }

    let product =
        pos.models?.["product.product"]?.getBy?.("id", productData.id) ||
        pos.models?.["product.product"]?.getAll?.().find((p) => p.id === productData.id) ||
        pos.db?.get_product_by_id?.(productData.id) ||
        null;

    if (!product) {
        console.error("PCI ERROR: producto no está en el POS", productData);

        screen.dialog.add(AlertDialog, {
            title: "Producto no disponible",
            body: `${productData.display_name || "El producto configurado"} no está cargado en el POS.`,
        });

        return null;
    }

    const line = await pos.addLineToCurrentOrder(
        {
            product_id: product,
            qty: 1,
            price_unit: Number(price || 0),
        },
        {},
        false
    );

    console.log("PCI addProductToOrder price_unit stored:", line?.price_unit);
    return line;
}

async function waitPosRecompute() {
    await new Promise((resolve) => setTimeout(resolve, 50));
}

async function upsertSurchargeLine(screen, order, surchargeAmount) {
    const targetSurcharge = roundMoney(surchargeAmount);
    const product = await getCachedSurchargeProduct(screen);

    if (!product?.id) {
        if (targetSurcharge > 0) {
            screen.dialog.add(AlertDialog, {
                title: _t("Falta configuración"),
                body: _t(
                    "No se encontró el producto de recargo financiero configurado en el Punto de Venta."
                ),
            });
        }
        return null;
    }

    let line = findProductLine(order, product.id);

    if (targetSurcharge <= 0) {
        removeOrderline(order, line);
        return null;
    }

    if (line) {
        setOrderlinePrice(line, 0);
        setOrderlineQty(line, 1);
        setOrderlineDiscount(line, 0);
        await waitPosRecompute();
    }

    const baseTotal = roundMoney(getOrderTotal(order));
    let priceUnit = targetSurcharge;

    if (line) {
        setOrderlinePrice(line, priceUnit);
        setOrderlineQty(line, 1);
        setOrderlineDiscount(line, 0);
    } else {
        line = await addProductToOrder(screen, product, priceUnit);
    }

    if (!line) {
        return null;
    }

    setOrderlineDiscount(line, 0);

    // El recargo almacenado en los pagos es un importe final con impuestos.
    // Medimos el impacto real de la línea para no asumir una tasa ni price_include.
    for (let i = 0; i < 8; i++) {
        await waitPosRecompute();

        const currentTotal = roundMoney(getOrderTotal(order));
        const realDelta = roundMoney(currentTotal - baseTotal);
        const diff = roundMoney(targetSurcharge - realDelta);

        console.log("PCI surcharge calibration", {
            step: i,
            baseTotal,
            currentTotal,
            targetSurcharge,
            realDelta,
            diff,
            priceUnit,
        });

        if (diff === 0) {
            break;
        }

        if (Math.abs(realDelta) > 0.000001) {
            priceUnit = roundPrice(priceUnit * (targetSurcharge / realDelta));
        } else {
            priceUnit = roundPrice(priceUnit + diff);
        }

        setOrderlinePrice(line, priceUnit);
        setOrderlineQty(line, 1);
    }

    await waitPosRecompute();

    // Product Price puede estar configurado sin decimales. En ese caso, el precio
    // unitario no puede absorber diferencias de centavos (con IVA, cada salto puede
    // valer más de una unidad). Dejamos el precio por encima del objetivo y usamos
    // el descuento, que conserva decimales, para alcanzar el total bruto exacto.
    let currentTotal = roundMoney(getOrderTotal(order));
    let realDelta = roundMoney(currentTotal - baseTotal);

    if (realDelta > 0 && realDelta < targetSurcharge) {
        const storedPrice = Number(line.price_unit || priceUnit || 0);
        const raisedPrice = Math.max(
            storedPrice + 1,
            Math.ceil(storedPrice * (targetSurcharge / realDelta))
        );
        setOrderlinePrice(line, raisedPrice);
        setOrderlineQty(line, 1);
        setOrderlineDiscount(line, 0);
        await waitPosRecompute();
    }

    let discount = Number(line.discount || 0);
    for (let i = 0; i < 12; i++) {
        currentTotal = roundMoney(getOrderTotal(order));
        realDelta = roundMoney(currentTotal - baseTotal);
        const diff = roundMoney(targetSurcharge - realDelta);

        console.log("PCI surcharge discount calibration", {
            step: i,
            baseTotal,
            currentTotal,
            targetSurcharge,
            realDelta,
            diff,
            priceUnit: line.price_unit,
            discount,
        });

        if (diff === 0 || realDelta <= 0) {
            break;
        }

        const currentMultiplier = (100 - discount) / 100;
        const desiredMultiplier = currentMultiplier * (targetSurcharge / realDelta);
        discount = roundPrice(100 * (1 - desiredMultiplier));
        discount = Math.max(0, Math.min(99.999999, discount));
        setOrderlineDiscount(line, discount);
        await waitPosRecompute();
    }

    currentTotal = roundMoney(getOrderTotal(order));
    realDelta = roundMoney(currentTotal - baseTotal);

    console.log("PCI surcharge calibration final", {
        baseTotal,
        currentTotal,
        targetSurcharge,
        realDelta,
        diff: roundMoney(targetSurcharge - realDelta),
        priceUnit: line.price_unit,
        discount: line.discount,
    });

    console.log("PCI order lines after surcharge", getOrderLines(order).map((line) => ({
        product: line.product_id?.display_name || line.product_id?.name,
        price_unit: line.price_unit,
        qty: line.qty,
        discount: line.discount,
        price_subtotal: line.price_subtotal,
        price_subtotal_incl: line.price_subtotal_incl,
    })));

    return line;
}

async function refreshSurchargeLine(screen, order) {
    await upsertSurchargeLine(screen, order, getTotalCardAdjustment(order));
    screen.render(true);
}
patch(PaymentScreen.prototype, {
    async addNewPaymentLine(paymentMethod) {
        const result = await super.addNewPaymentLine(...arguments);
    
        console.log("PCI paymentMethod", paymentMethod);
        console.log("PCI pci_card_data raw", paymentMethod?.pci_card_data);
    
        try {
            if (!result || !paymentMethod?.pci_use_installments) {
                return result;
            }
    
            const cards = Array.isArray(paymentMethod.pci_card_data)
                ? paymentMethod.pci_card_data
                : paymentMethod.pci_card_data
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
            const netAmount = roundMoney(currentLineAmount > 0 ? currentLineAmount : due);
    
            console.log("PCI order.payment_ids", order.payment_ids);
            console.log("PCI selected/fallback line", paymentLine);
            console.log("PCI netAmount used", {
                currentLineAmount,
                due,
                netAmount,
            });
    
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
                rounding_amount,
                total_amount,
            } = payload;
    
            let activePaymentLine = this.selectedPaymentLine || order.getSelectedPaymentline();
    
            if (!activePaymentLine && order.payment_ids?.length) {
                activePaymentLine = order.payment_ids.at(-1);
            }
    
            if (!activePaymentLine) {
                console.warn("PCI: no se encontró payment line después de agregar recargo");
                this.render(true);
                return result;
            }
    
            activePaymentLine.card_id = card_id;
            activePaymentLine.installment_id = installment_id;
            activePaymentLine.pci_card_ref_id = card_id;
            activePaymentLine.pci_installment_ref_id = installment_id;

            if (paymentMethod.pci_force_invoice) {
                if (typeof order.setToInvoice === "function") {
                    order.setToInvoice(true);
                } else {
                    order.to_invoice = true;
                }
            }
    
            const roundedNet = roundMoney(net_amount);
            const roundedTotal = ceilMoney(total_amount);
            const roundedSurcharge = roundMoney(surcharge_amount);
            const roundedAdjustment = roundMoney(rounding_amount);
    
            activePaymentLine.net_amount = roundedNet;
            activePaymentLine.financing_surcharge = roundedSurcharge;
            activePaymentLine.rounding_adjustment = roundedAdjustment;
            activePaymentLine.total_amount = roundedTotal;
    
            // El recargo financiero y el redondeo se contabilizan en el mismo producto.
            // El desglose se conserva en la línea de pago para fines de auditoría.
            await upsertSurchargeLine(this, order, getTotalCardAdjustment(order));

            const paymentTotal = roundedTotal;
            setPaymentAmount(activePaymentLine, paymentTotal);
            await waitPosRecompute();

            if (typeof order.selectPaymentline === "function") {
                order.selectPaymentline(activePaymentLine);
            }
    
            if (this.numberBuffer && typeof this.numberBuffer.reset === "function") {
                this.numberBuffer.reset();
            }
    
            if (this.numberBuffer && typeof this.numberBuffer.set === "function") {
                this.numberBuffer.set(String(paymentTotal));
            }
    
            console.log("PCI payment line FINAL", {
                paymentTotal,
                card_id: activePaymentLine.card_id,
                installment_id: activePaymentLine.installment_id,
                pci_card_ref_id: activePaymentLine.pci_card_ref_id,
                pci_installment_ref_id: activePaymentLine.pci_installment_ref_id,
                net_amount: activePaymentLine.net_amount,
                financing_surcharge: activePaymentLine.financing_surcharge,
                rounding_adjustment: activePaymentLine.rounding_adjustment,
                total_amount: activePaymentLine.total_amount,
            });
    
            this.render(true);
            return result;
        } catch (error) {
            console.error("PCI ERROR", error);
            return result;
        }
    },

    async deletePaymentLine(uuid) {
        const order = this.currentOrder;

        let lineToDelete = null;
        if (order?.payment_ids?.length) {
            lineToDelete = order.payment_ids.find((line) => line.uuid === uuid) || null;
        }

        const result = await super.deletePaymentLine(...arguments);

        try {
            if (!order) {
                return result;
            }

            if (lineToDelete?.installment_id || lineToDelete?.financing_surcharge) {
                lineToDelete.financing_surcharge = 0;
                lineToDelete.rounding_adjustment = 0;
                lineToDelete.total_amount = 0;
                lineToDelete.net_amount = 0;
                lineToDelete.card_id = false;
                lineToDelete.installment_id = false;
                lineToDelete.pci_card_ref_id = 0;
                lineToDelete.pci_installment_ref_id = 0;
            }

            await refreshSurchargeLine(this, order);

            return result;
        } catch (error) {
            console.error("PCI deletePaymentLine ERROR", error);
            return result;
        }
    },
});
