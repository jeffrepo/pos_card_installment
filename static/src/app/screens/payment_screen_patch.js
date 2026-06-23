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

function setPaymentAmount(line, amount) {
    const value = ceilMoney(amount);
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
    const value = ceilMoney(amount);
    if (!line) {
        return;
    }
    if (typeof line.set_unit_price === "function") {
        line.set_unit_price(value);
        console.log("PCI setOrderlinePrice via set_unit_price:", value, "-> price_unit after:", line.price_unit);
        return;
    }
    if (typeof line.setUnitPrice === "function") {
        line.setUnitPrice(value);
        console.log("PCI setOrderlinePrice via setUnitPrice:", value, "-> price_unit after:", line.price_unit);
        return;
    }
    if (typeof line.price_unit !== "undefined") {
        line.price_unit = value;
        console.log("PCI setOrderlinePrice direct:", value, "-> price_unit after:", line.price_unit);
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

function getTotalFinancingSurcharge(order) {
    const payments = order?.payment_ids || [];
    return payments.reduce((total, payment) => {
        return total + ceilMoney(payment.financing_surcharge || 0);
    }, 0);
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

    // 🔥 buscar en catálogo POS
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

    // 🔥 método correcto en Odoo 19
    const line = await pos.addLineToCurrentOrder(
        {
            product_id: product,
            qty: 1,
            price_unit: ceilMoney(price),
        },
        {},
        false
    );

    console.log("PCI addProductToOrder price_unit stored:", line?.price_unit);
    return line;
}

function _pciSetTaxPriceInclude(line, include) {
    // Marcar los taxes de la línea como price_include para que Odoo
    // no sume IVA encima del precio ya seteado (que ya incluye IVA)
    try {
        const taxes = line.tax_ids || line.taxes_id || [];
        const taxArray = Array.isArray(taxes) ? taxes : (taxes.models || []);
        for (const tax of taxArray) {
            if (typeof tax === "object" && tax !== null) {
                tax.price_include = include;
                // Odoo 17+ usa is_base_affected
                if ("is_base_affected" in tax) {
                    tax.is_base_affected = !include;
                }
            }
        }
        // Forzar recalculo
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

    if (surchargeAmount > 0) {
        // La moneda (ARS) tiene rounding=1, entonces Odoo redondea price_unit a entero.
        // No podemos usar decimales en price_unit. Estrategia: marcar los taxes de la
        // línea como price_include=true DESPUÉS de crearla, y pasar el monto bruto
        // redondeado como price_unit. Así Odoo no suma IVA encima.
        const surchargeRounded = ceilMoney(surchargeAmount);
        console.log("PCI upsertSurchargeLine surchargeAmount:", surchargeAmount, "surchargeRounded:", surchargeRounded);

        if (line) {
            setOrderlinePrice(line, surchargeRounded);
            setOrderlineQty(line, 1);
            _pciSetTaxPriceInclude(line, true);
        } else {
            line = await addProductToOrder(screen, product, surchargeRounded);
            if (line) {
                _pciSetTaxPriceInclude(line, true);
            }
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
            const netAmount = ceilMoney(currentLineAmount > 0 ? currentLineAmount : due);

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

            //await upsertSurchargeLine(this, order, Number(surcharge_amount || 0));

            let activePaymentLine = this.selectedPaymentLine || order.getSelectedPaymentline();
            if (!activePaymentLine && order.payment_ids?.length) {
                activePaymentLine = order.payment_ids.at(-1);
            }

            if (!activePaymentLine) {
                console.warn("PCI: no se encontró payment line después de agregar recargo");
                this.render(true);
                return result;
            }

            // 🔥 GUARDAR DATOS EN LA PAYMENT LINE
            activePaymentLine.card_id = card_id;
            activePaymentLine.installment_id = installment_id;
            const roundedNet = ceilMoney(net_amount);
            const roundedTotal = ceilMoney(total_amount);
            const roundedSurcharge = ceilMoney(roundedTotal - roundedNet);

            activePaymentLine.net_amount = roundedNet;
            activePaymentLine.financing_surcharge = roundedSurcharge;
            activePaymentLine.total_amount = roundedTotal;

            // 🔥 RECALCULAR RECARGO TOTAL Y AGREGAR LÍNEA
            const totalSurcharge = getTotalFinancingSurcharge(order);
            await upsertSurchargeLine(this, order, totalSurcharge);

            // Esperar que OWL termine de recalcular el pedido tras agregar la línea de recargo
            await new Promise(resolve => setTimeout(resolve, 50));

            // Setear el monto con el total_amount del popup (verdad final)
            const paymentTotal = roundedTotal;
            console.log("PCI total_amount popup:", total_amount, "paymentTotal rounded up:", paymentTotal);
            setPaymentAmount(activePaymentLine, paymentTotal);

            // Segundo set tras otro tick para cubrir cualquier reactividad de OWL
            await new Promise(resolve => setTimeout(resolve, 50));
            setPaymentAmount(activePaymentLine, paymentTotal);

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
});