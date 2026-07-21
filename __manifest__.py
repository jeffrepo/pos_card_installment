{
    "name": "POS Card Installment",
    "version": "19.0.1.2.0",
    "summary": "Card/installment selection in POS reusing existing payment surcharge logic",
    "category": "Point of Sale",
    "author": "Silva Technologies",
    "license": "LGPL-3",
    "depends": [
        "point_of_sale",
        "account_payment_pro",
        "account_payment_financial_surcharge"
    ],
    "data": [
        "views/pos_payment_method_views.xml",
        "views/pos_config_views.xml",
        #"views/pos_payment_views.xml"
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_card_installment/static/src/app/popups/card_installment_popup.js",
            "pos_card_installment/static/src/app/popups/card_installment_popup.xml",
            "pos_card_installment/static/src/app/screens/payment_screen_patch.js"
        ]
    },
    "installable": True,
    "application": False
}
