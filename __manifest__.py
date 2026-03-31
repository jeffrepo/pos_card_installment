# -*- coding: utf-8 -*-
{
    "name": "POS Card Installment",
    "summary": "Tarjetas, cuotas y nota de débito por recargo en Punto de Venta",
    "version": "19.0.1.0.0",
    "category": "Point of Sale",
    "author": "Silva technologies",
    "license": "LGPL-3",
    "depends": [
        "point_of_sale",
        "account",
        "l10n_ar",
        "l10n_ar_edi",
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/pos_payment_method_views.xml",
        "views/pos_card_brand_views.xml",
        "views/pos_card_installment_plan_views.xml",
        "views/pos_order_views.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_card_installment/static/src/app/store/payment_patch.js",
            "pos_card_installment/static/src/app/store/pos_store_patch.js",
            "pos_card_installment/static/src/app/screens/payment_screen_patch.js",
            "pos_card_installment/static/src/app/popup/card_installment_popup.js",
            "pos_card_installment/static/src/xml/card_installment_popup.xml",
            "pos_card_installment/static/src/xml/payment_screen.xml",
        ],
    },
    "installable": True,
}
