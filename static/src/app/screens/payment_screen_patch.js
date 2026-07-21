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

function getTotalFinancingSurcharge(order) {
    const payments = order?.payment_ids || [];
    return roundMoney(payments.reduce((total, payment) => {
        return total + Number(payment.financing_surcharge || 0);
    }, 0));
}

async function getCachedSurchargeProduct(screen) {
    if (screen.pos.pci_surcharge_product_cache) {
        return screen.pos.pci_surcharge_product_cache;
    }

    const orm = screen.env.services.orm;
    const configId = screen.pos?.config?.id;

    if (!orm || !configId) {
        return null;
    }

    const configData = await orm.read(
        "pos.config",
        [configId],
        ["pci_surcharge_product_id"]
    );

    const raw = configData?.[0]?.pci_surcharge_product_id;
    console.log("PCI surcharge config via RPC", raw);

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
        ["id", "display_name", "product_tmpl_id", "available_in_pos", "sale_ok"]
    );

    const product = products?.[0] || null;
    console.log("PCI surcharge product via RPC", product);

    if (product) {
        screen.pos.pci_surcharge_product_cache = product;
    }

    return product;
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
            body: "El producto de recargo no está cargado en el POS.",
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

function _pciSetTaxPriceInclude(line, include) {
    try {
        const taxes = line.tax_ids || line.taxes_id || [];
        const taxArray = Array.isArray(taxes) ? taxes : (taxes.models || []);
        for (const tax of taxArray) {
            if (typeof tax === "object" && tax !== null) {
                tax.price_include = include;
                if ("is_base_affected" in tax) {
                    tax.is_base_affected = !include;
                }
            }
        }
        if (typeof line.computeAll === "function") {
            line.computeAll();
        } else if (typeof line.compute_all === "function") {
            line.compute_all();
        } else if (typeof line.updateTax === "function") {
            line.updateTax();
        } else if (typeof line.set_unit_price === "function") {
            line.set_unit_price(line.price_unit);
        }
        console.log("PCI _pciSetTaxPriceInclude: tax price_include =", include, "price_unit:", line.price_unit);
    } catch(e) {
        console.warn("PCI _pciSetTaxPriceInclude error:", e);
    }
}

async function waitPosRecompute() {
    await new Promise((resolve) => setTimeout(resolve, 50));
}

async function upsertSurchargeLine(screen, order, surchargeAmount) {
    const product = await getCachedSurchargeProduct(screen);

    if (!product?.id) {
        screen.dialog.add(AlertDialog, {
            title: _t("Falta configuración"),
            body: _t(
                "No se encontró el producto de recargo financiero configurado en el Punto de Venta."
            ),
        });
        return null;
    }

    let line = findSurchargeLine(order, product.id);

    const targetSurcharge = roundMoney(surchargeAmount);

    if (targetSurcharge > 0) {
        // Total base del pedido sin el recargo actual.
        let baseTotal = getOrderTotal(order);

        if (line) {
            setOrderlinePrice(line, 0);
            setOrderlineQty(line, 1);
            await waitPosRecompute();
            baseTotal = getOrderTotal(order);
        }

        // Primer intento: usar el recargo bruto.
        let priceUnit = targetSurcharge;

        if (line) {
            setOrderlinePrice(line, priceUnit);
            setOrderlineQty(line, 1);
        } else {
            line = await addProductToOrder(screen, product, priceUnit);
        }

        // Calibrar para que el aumento real del pedido sea igual al recargo esperado.
        for (let i = 0; i < 4; i++) {
            await waitPosRecompute();

            const currentTotal = getOrderTotal(order);
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

            if (Math.abs(diff) <= 0.01) {
                break;
            }

            if (realDelta) {
                priceUnit = roundMoney(priceUnit * (targetSurcharge / realDelta));
            } else {
                priceUnit = roundMoney(priceUnit + diff);
            }

            setOrderlinePrice(line, priceUnit);
            setOrderlineQty(line, 1);
        }

        // Ajuste final por redondeo:
        // Queremos que el total del pedido quede igual al total cobrado redondeado hacia arriba.
        await waitPosRecompute();

        const finalOrderTotal = getOrderTotal(order);
        const targetOrderTotal = ceilMoney(baseTotal + targetSurcharge);
        const finalDiff = roundMoney(targetOrderTotal - finalOrderTotal);

        console.log("PCI surcharge final rounding", {
            baseTotal,
            finalOrderTotal,
            targetOrderTotal,
            finalDiff,
            priceUnit,
        });

        // Solo corregimos diferencias pequeñas de redondeo.
        if (Math.abs(finalDiff) <= 2 && line) {
            priceUnit = roundMoney(priceUnit + finalDiff);
            setOrderlinePrice(line, priceUnit);
            setOrderlineQty(line, 1);
            await waitPosRecompute();

            console.log("PCI surcharge final adjusted", {
                priceUnit,
                orderTotal: getOrderTotal(order),
            });
        }
    } else if (line) {
        if (typeof order.removeOrderline === "function") {
            order.removeOrderline(line);
        } else if (typeof order.remove_orderline === "function") {
            order.remove_orderline(line);
        }
        line = null;
    }

    console.log("PCI order lines after surcharge", getOrderLines(order).map((line) => ({
        product: line.product_id?.display_name || line.product_id?.name,
        price_unit: line.price_unit,
        qty: line.qty,
        price_subtotal: line.price_subtotal,
        price_subtotal_incl: line.price_subtotal_incl,
    })));

    return line;
}

async function adjustSurchargeLineToTargetTotal(screen, order, targetTotal) {
    const product = await getCachedSurchargeProduct(screen);

    if (!product?.id) {
        return;
    }

    const line = findSurchargeLine(order, product.id);

    if (!line) {
        return;
    }

    let priceUnit = Number(line.price_unit || 0);

    for (let i = 0; i < 5; i++) {
        await waitPosRecompute();

        const currentTotal = roundMoney(getOrderTotal(order));
        const diff = roundMoney(targetTotal - currentTotal);

        console.log("PCI direct surcharge target adjustment", {
            step: i,
            targetTotal,
            currentTotal,
            diff,
            priceUnit,
        });

        if (Math.abs(diff) <= 0.01) {
            break;
        }

        // Como la línea tiene IVA 21%, el impacto aproximado sobre total es price_unit * 1.21.
        // Por eso ajustamos el precio base con diff / 1.21.
        priceUnit = roundMoney(priceUnit + (diff / 1.21));

        setOrderlinePrice(line, priceUnit);
        setOrderlineQty(line, 1);
    }

    await waitPosRecompute();

    console.log("PCI direct surcharge target final", {
        targetTotal,
        orderTotal: roundMoney(getOrderTotal(order)),
        priceUnit: line.price_unit,
    });
}

async function adjustOrderTotalForRoundedRemaining(screen, order) {
    await waitPosRecompute();

    const orderTotal = roundMoney(getOrderTotal(order));

    const totalPaid = roundMoney(Array.from(order.payment_ids || []).reduce((sum, payment) => {
        const amount =
            typeof payment.getAmount === "function"
                ? Number(payment.getAmount() || 0)
                : Number(payment.amount || 0);

        return sum + amount;
    }, 0));

    const remaining = roundMoney(orderTotal - totalPaid);

    console.log("PCI rounded remaining check", {
        orderTotal,
        totalPaid,
        remaining,
    });

    // Si ya está cerrado, no hacemos nada.
    if (Math.abs(remaining) <= 0.01) {
        return;
    }

    let targetOrderTotal = orderTotal;

    // Si todavía queda saldo, hacemos que el restante quede entero hacia arriba.
    if (remaining > 0) {
        targetOrderTotal = roundMoney(totalPaid + ceilMoney(remaining));
    }

    // Si hay cambio pequeño, hacemos que el pedido cierre contra lo pagado.
    if (remaining < 0 && Math.abs(remaining) <= 2) {
        targetOrderTotal = totalPaid;
    }

    const diff = roundMoney(targetOrderTotal - orderTotal);

    console.log("PCI rounded remaining target", {
        orderTotal,
        totalPaid,
        remaining,
        targetOrderTotal,
        diff,
    });

    // Solo ajustamos diferencias pequeñas de redondeo.
    if (Math.abs(diff) > 2 || diff === 0) {
        return;
    }

    await adjustSurchargeLineToTargetTotal(screen, order, targetOrderTotal);
    await waitPosRecompute();

    console.log("PCI rounded remaining result", {
        orderTotal: roundMoney(getOrderTotal(order)),
        totalPaid,
        remaining: roundMoney(getOrderTotal(order) - totalPaid),
    });
}

async function refreshSurchargeLine(screen, order) {
    const totalSurcharge = getTotalFinancingSurcharge(order);
    await upsertSurchargeLine(screen, order, totalSurcharge);
    screen.render(true);
}

async function computeSurchargeNeededForPaidTotal(screen, order, totalPaid) {
    const product = await getCachedSurchargeProduct(screen);

    if (!product?.id) {
        return null;
    }

    const line = findSurchargeLine(order, product.id);

    if (!line) {
        return null;
    }

    const oldPriceUnit = Number(line.price_unit || 0);

    // Quitar temporalmente el recargo para conocer el total base real.
    setOrderlinePrice(line, 0);
    setOrderlineQty(line, 1);
    await waitPosRecompute();

    const baseTotal = roundMoney(getOrderTotal(order));

    // Restaurar temporalmente antes de que upsertSurchargeLine haga su propio proceso.
    setOrderlinePrice(line, oldPriceUnit);
    setOrderlineQty(line, 1);
    await waitPosRecompute();

    const neededSurcharge = roundMoney(totalPaid - baseTotal);

    console.log("PCI compute surcharge needed", {
        totalPaid,
        baseTotal,
        neededSurcharge,
    });

    return neededSurcharge;
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
    
            const roundedNet = roundMoney(net_amount);
            const roundedTotal = ceilMoney(total_amount);
            const roundedSurcharge = roundMoney(roundedTotal - roundedNet);
    
            activePaymentLine.net_amount = roundedNet;
            activePaymentLine.financing_surcharge = roundedSurcharge;
            activePaymentLine.total_amount = roundedTotal;
    
            // Recalcular recargo total acumulado de todas las líneas de pago.
            const totalSurcharge = getTotalFinancingSurcharge(order);
    
            await upsertSurchargeLine(this, order, totalSurcharge);
    
            await waitPosRecompute();
    
            let paymentTotal = roundedTotal;
    
            const orderTotalAfterSurcharge = roundMoney(getOrderTotal(order));
            const payments = Array.from(order.payment_ids || []);
    
            const otherPaymentsTotal = roundMoney(payments.reduce((sum, payment) => {
                if (payment === activePaymentLine) {
                    return sum;
                }
    
                const amount =
                    typeof payment.getAmount === "function"
                        ? Number(payment.getAmount() || 0)
                        : Number(payment.amount || 0);
    
                return sum + amount;
            }, 0));
    
            const expectedRemaining = roundMoney(orderTotalAfterSurcharge - otherPaymentsTotal);
            const diffToRemaining = roundMoney(expectedRemaining - paymentTotal);
    
            console.log("PCI multi-payment final diff", {
                orderTotalAfterSurcharge,
                otherPaymentsTotal,
                expectedRemaining,
                paymentTotal,
                diffToRemaining,
            });
    
            /*
             * Regla:
             * - Si el pago actual prácticamente cierra el saldo restante, absorbe redondeo.
             * - Si no, respeta el total calculado por el popup.
             *
             * Esto evita que los pagos intermedios alteren el cálculo global,
             * pero permite que el último pago cierre diferencias mínimas.
             */
            if (Math.abs(diffToRemaining) <= 5) {
                paymentTotal = ceilMoney(expectedRemaining);
            } else {
                paymentTotal = ceilMoney(paymentTotal);
            }
                
            activePaymentLine.total_amount = paymentTotal;
    
            console.log("PCI total_amount popup:", total_amount, "paymentTotal adjusted:", paymentTotal);
    
            setPaymentAmount(activePaymentLine, paymentTotal);
    
            await waitPosRecompute();
    
            setPaymentAmount(activePaymentLine, paymentTotal);

            await waitPosRecompute();
            
            const finalOrderTotal = roundMoney(getOrderTotal(order));
            const totalPaid = roundMoney(Array.from(order.payment_ids || []).reduce((sum, payment) => {
                const amount =
                    typeof payment.getAmount === "function"
                        ? Number(payment.getAmount() || 0)
                        : Number(payment.amount || 0);
            
                return sum + amount;
            }, 0));
            
            const finalPaymentDiff = roundMoney(totalPaid - finalOrderTotal);
            
            console.log("PCI final payment vs order diff", {
                finalOrderTotal,
                totalPaid,
                finalPaymentDiff,
            });
            
            // Si la diferencia final es pequeña, ajustamos DIRECTAMENTE la línea de recargo
            // para que el total del pedido sea igual a la suma de pagos redondeados.
            if (Math.abs(finalPaymentDiff) <= 2 && finalPaymentDiff !== 0) {
                await adjustSurchargeLineToTargetTotal(this, order, totalPaid);
            }
            
            await adjustOrderTotalForRoundedRemaining(this, order);    
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
                net_amount: activePaymentLine.net_amount,
                financing_surcharge: activePaymentLine.financing_surcharge,
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

            if (lineToDelete?.financing_surcharge) {
                lineToDelete.financing_surcharge = 0;
                lineToDelete.total_amount = 0;
                lineToDelete.net_amount = 0;
                lineToDelete.card_id = false;
                lineToDelete.installment_id = false;
            }

            await refreshSurchargeLine(this, order);

            return result;
        } catch (error) {
            console.error("PCI deletePaymentLine ERROR", error);
            return result;
        }
    },
});