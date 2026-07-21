# POS Card Installment

Agrega selección de tarjeta y plan de cuotas al pago del Punto de Venta. El recargo
financiero se registra en una línea independiente y el total se redondea hacia arriba
solo cuando la orden contiene un pago con tarjeta/cuotas.

## Configuración

En la configuración del Punto de Venta seleccione:

- Un producto para el recargo financiero.
- Un producto distinto para el ajuste de redondeo, disponible en el POS y sin impuestos
  de venta.

El producto de redondeo no se utiliza en ventas pagadas únicamente con efectivo u otros
métodos sin cuotas.
