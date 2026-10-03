# Historial auditable de transacciones

Imagina un pago que hoy figura como «completado». Si alguien pregunta qué pasó en el camino —si el banco lo rechazó, si hubo un reintento, quién lo aprobó— un registro que solo guarda el estado final no alcanza. Este proyecto guarda cada paso como un hecho que ya ocurrió y que no se reescribe.

Eso es Event Sourcing. El sistema no actualiza una fila. Agrega una línea nueva al final de un archivo, `event-store.jsonl`. Para saber cómo está una transacción ahora, se leen sus líneas desde el principio y se vuelven a aplicar. El resultado es el estado actual. Las líneas, en orden, son el historial.

Hay dos programas, a propósito separados:

- **Transaction API** (puerto 3000) recibe las acciones: crear, cobrar, rechazar, reintentar, aprobar, cerrar. Solo escribe.
- **History API** (puerto 3001) no acepta acciones. Lee el mismo archivo y muestra dos cosas: el estado reconstruido y la lista de eventos.

Si las dos arrancan desde la misma carpeta, ven el mismo archivo `data/event-store.jsonl`.

## Antes de empezar

Hace falta Node.js 22 y npm. Abre una terminal en la carpeta `proyectoparadigmaeventsourcing` y deja instaladas las dependencias:

```powershell
npm ci
```

Todos los comandos de esta guía se ejecutan desde esa carpeta.

## La historia que el sistema sabe contar

Una transacción no puede saltar de «recién creada» a «terminada». Cada evento solo es válido si el anterior lo permite.

El camino con un rechazo se ve así:

1. `TransactionCreated` — alguien inicia la operación. Estado: `CREATED`.
2. `PaymentRequested` — se pide el cobro. Estado: `PAYMENT_PENDING`. Este es el intento 1.
3. `PaymentRejected` — el pago no pasa, y queda guardado el motivo. Estado: `PAYMENT_REJECTED`.
4. `PaymentRetried` — se intenta de nuevo. El sistema pone el intento 2, no el número que invente el cliente. Estado: otra vez `PAYMENT_PENDING`.
5. `PaymentApproved` — el pago pasa y queda el código de aprobación. Estado: `PAYMENT_APPROVED`.
6. `TransactionCompleted` — la operación se cierra. Estado: `COMPLETED`.

Si el primer cobro sale bien, se salta el rechazo y el reintento: de `PaymentRequested` se pasa directo a `PaymentApproved`.

Dos reglas más, fáciles de notar cuando pruebes:

- El monto del pago tiene que ser el mismo con el que se creó la transacción. Si pides cobrar 10 cuando la transacción es de 15000, el comando se rechaza y no se escribe nada.
- `expectedVersion` es la versión que tú crees que tiene la transacción ahora. Si alguien avanzó el historial mientras tanto, tu número ya no coincide y el comando responde 409. Así no se pisan dos escrituras.

## Etapa 1. El dominio, sin pantalla

Esta etapa no tiene página ni puerto. Es la biblioteca que las otras dos usan para ponerse de acuerdo.

Ahí viven los seis tipos de evento, la regla de «qué puede pasar después» y la función `replay`, que recorre los eventos y arma el estado. Escritura y lectura usan la misma regla. Por eso un historial imposible, por ejemplo crear y enseguida completar, no se guarda y tampoco se puede «reconstruir» como si hubiera sido válido.

También está el lector del archivo. Cada línea tiene que ser un evento de verdad, de la misma transacción y con la versión siguiente. Si una línea del medio está rota, el archivo entero se considera dañado: no se muestra «lo que se pudo leer». Si solo la última línea quedó cortada a la mitad, porque una escritura se interrumpió, esa cola se ignora y el resto sigue valiendo.

Para ver esta etapa no se levanta ningún servidor. Se corren sus pruebas:

```powershell
npm test --workspace=@eventsourcing/domain
```

Vas a ver casos del camino feliz, del rechazo con reintento, de una versión que se salta, de un evento de otra transacción y de un archivo con una línea corrupta. Si terminan en verde, el dominio está haciendo ese trabajo.

## Etapa 2. Registrar lo que va pasando

La Transaction API es el mostrador donde se piden los cambios. Cada pedido, si es válido, agrega una línea al final de `data/event-store.jsonl` y responde con el evento nuevo y el estado ya reconstruido.

Levántala:

```powershell
npm run start:dev
```

Cuando diga que está escuchando, abre [http://localhost:3000/api/docs](http://localhost:3000/api/docs). Esa página es Swagger: lista los comandos y deja ejecutarlos desde el navegador.

### Un recorrido con rechazo

En `POST /transactions`, usa **Try it out** y envía:

```json
{
  "amount": 15000,
  "currency": "CRC",
  "customerId": "cliente-456"
}
```

La respuesta es 201. Fíjate en tres datos, porque los vas a necesitar:

- `event.transactionId`: el identificador. Si no lo enviaste, el sistema lo inventó.
- `state.status`: debe decir `CREATED`.
- `state.version`: debe ser `1`. La moneda queda guardada en mayúsculas, `CRC`, aunque la hayas escrito en minúsculas.

A partir de aquí cada comando lleva ese id en la URL y, en el cuerpo, la versión que acabas de ver. El siguiente número siempre es el que devolvió el comando anterior.

| Qué quieres hacer | Dónde, en Swagger | Cuerpo |
| --- | --- | --- |
| Pedir el cobro | `POST /transactions/{id}/request-payment` | `{ "expectedVersion": 1 }` |
| Registrar el rechazo | `POST /transactions/{id}/reject-payment` | `{ "reason": "Fondos insuficientes", "expectedVersion": 2 }` |
| Reintentar | `POST /transactions/{id}/retry-payment` | `{ "expectedVersion": 3 }` |
| Aprobar | `POST /transactions/{id}/approve-payment` | `{ "approvalCode": "AUTH-982143", "expectedVersion": 4 }` |
| Cerrar | `POST /transactions/{id}/complete` | `{ "expectedVersion": 5 }` |

Después del reintento, `state.attemptCount` debe ser `2`. Al cerrar, `status` debe ser `COMPLETED` y `version` `6`. En la carpeta `data` ya existe `event-store.jsonl`: ábrelo con un editor de texto. Cada línea es un evento. No hay una línea que «actualice» a otra; solo se suman.

### Qué pasa si te equivocas

Prueba estas tres a propósito. Ninguna debe agregar una línea.

- Pedir el pago con `"amount": 10` cuando la transacción es de 15000. Respuesta 400: el monto no coincide.
- Pedir el pago con `"expectedVersion": 99`. Respuesta 409: la versión actual no es esa.
- Completar apenas después de crear, sin haber cobrado. Respuesta 400: `TransactionCompleted` no es válido en `CREATED`.

Si no quieres pasar por el rechazo, después de pedir el pago puedes aprobar directo y luego completar. En ese caso las versiones son 1 (crear), 2 (cobrar), 3 (aprobar) y 4 (cerrar).

### La misma API dentro de Docker

El `Dockerfile` de la raíz empaqueta solo esta API. Construye y arranca:

```powershell
docker build -t transaction-api .
docker run --rm -p 3000:3000 -v "${PWD}/data:/app/data" transaction-api
```

El volumen hace que el archivo quede en `data` de tu carpeta, no se pierda al apagar el contenedor. Swagger sigue en el puerto 3000. Si ya tienes `npm run start:dev` usando ese puerto, detén uno de los dos antes de levantar el otro.

## Etapa 3. Mirar el historial sin poder cambiarlo

La History API existe para contestar una pregunta distinta: «¿qué ocurrió y en qué estado quedó?». No tiene botones para crear ni aprobar. Cada vez que consultas, vuelve a leer el archivo y aplica `replay`. Si la Transaction API escribió una línea nueva, al actualizar la pantalla ya está.

Con la Transaction API todavía encendida, abre **otra** terminal en la misma carpeta y ejecuta:

```powershell
npm run start:history:dev
```

Entra a [http://localhost:3001/](http://localhost:3001/).

La primera vez, si aún no creaste nada en Swagger, el selector solo dice «Selecciona una transacción». Eso es normal: la pantalla no inventa datos. Crea o avanza una transacción en el puerto 3000, vuelve aquí y pulsa **Actualizar lista**. Aparece el id junto con su estado, por ejemplo `COMPLETED`. Eliges esa opción, o pegas el id en el campo de texto, y pulsas **Consultar**.

Verás dos bloques:

- **Estado actual reconstruido.** Una fila por dato: estado, monto, moneda, intentos, motivo del último rechazo, código de aprobación, fecha de cierre.
- **Historial cronológico.** Una tarjeta por evento, de la versión 1 a la última, con el tipo y los datos de esa línea.

Si consultas un id que no está en el archivo, la pantalla muestra el 404 y deja los dos bloques vacíos. No rellena un estado falso.

### Si la lista sigue vacía

Casi siempre es porque cada programa está mirando un archivo distinto. Las dos terminales tienen que estar en `proyectoparadigmaeventsourcing`. Si quieres dejarlo explícito, en cada una, antes de arrancar:

```powershell
$env:EVENT_STORE_FILE = "$PWD\data\event-store.jsonl"
```

Luego `npm run start:dev` en una y `npm run start:history:dev` en la otra.

### Su propia imagen

Esta API tiene un Dockerfile aparte, `history/Dockerfile`. El contexto de construcción sigue siendo la carpeta del proyecto, porque la imagen también necesita el dominio compartido:

```powershell
docker build -f history/Dockerfile -t history-api .
```

Para que la pantalla muestre lo que ya escribió la Transaction API, el contenedor monta ese archivo y no puede modificarlo. Créalo antes (basta con haber hecho un alta en Swagger) y luego:

```powershell
docker run --rm -p 3001:3001 -v "${PWD}/data/event-store.jsonl:/data/event-store.jsonl:ro" history-api
```

La pantalla queda en [http://localhost:3001/](http://localhost:3001/). El `:ro` es la promesa de esta etapa: este proceso lee el historial y no lo altera.

## Cómo comprobar que todo sigue en pie

```powershell
npm test
```

Ejecuta las pruebas del dominio, de la Transaction API y de la History API, incluyendo las que llaman a la pantalla y a los endpoints de historial. Cada prueba usa un archivo temporal. Tu `data/event-store.jsonl` de la demo no se toca.

## Qué falta

La etapa 4 todavía no está: datos de prueba listos, un escenario feliz, uno con rechazo y una colección de Postman. La etapa 5 tampoco: un Docker Compose que levante las dos APIs juntas, los scripts de despliegue y el guion de la demo. Hoy se encienden por separado, con los comandos de arriba.
