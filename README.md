# Historial auditable de transacciones

Imagina un pago que hoy figura como «completado». Si alguien pregunta qué pasó en el camino —si el banco lo rechazó, si hubo un reintento, quién lo aprobó— un registro que solo guarda el estado final no alcanza. Este proyecto guarda cada paso como un hecho que ya ocurrió y que no se reescribe.

Eso es Event Sourcing. El sistema no actualiza una fila. Agrega una línea nueva al final de un archivo, `event-store.jsonl`. Para saber cómo está una transacción ahora, se leen sus líneas desde el principio y se vuelven a aplicar. El resultado es el estado actual. Las líneas, en orden, son el historial.

Hay tres programas, a propósito separados:

- **Transaction API** (puerto 3000) recibe las acciones: crear, cobrar, rechazar, reintentar, aprobar, cerrar. Solo escribe.
- **History API** (puerto 3001) no acepta acciones. Lee el mismo archivo y muestra dos cosas: el estado reconstruido y la lista de eventos.
- **Frontend** (puerto 5173) es la pantalla para crear una transacción y consultar su historial. Habla con las dos APIs; no guarda eventos.

Si las dos APIs arrancan desde la misma carpeta, ven el mismo archivo `data/event-store.jsonl`. Con Docker Compose ese archivo vive en un volumen: la Transaction API escribe y la History API lo monta en solo lectura.

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

## Etapa 4. Simular el escenario

Recorrer los comandos uno por uno en Swagger sirve para entender el flujo, pero para una demo hace falta tener datos listos y una forma rápida de mostrar que todo cuadra. Esta etapa trae dos herramientas: un script que llena el event store con casos variados y una colección de Postman para recorrerlos paso a paso.

### El script de simulación

Con las dos APIs encendidas (la Transaction API en el 3000 y la History API en el 3001), abre una tercera terminal en la misma carpeta y ejecuta:

```powershell
npm run simular
```

El script crea seis transacciones, cada una en un punto distinto de su vida:

| Escenario | Qué hace | Cómo termina |
| --- | --- | --- |
| Camino feliz | crear, cobrar, aprobar, cerrar | `COMPLETED`, versión 4, 1 intento |
| Rechazo y reintento | crear, cobrar, rechazar, reintentar, aprobar, cerrar | `COMPLETED`, versión 6, 2 intentos |
| Rechazada dos veces | crear, cobrar, rechazar, reintentar, rechazar | `PAYMENT_REJECTED`, versión 5, 2 intentos |
| Pago pendiente | crear, cobrar | `PAYMENT_PENDING`, versión 2 |
| Recién creada | crear | `CREATED`, versión 1 |
| Errores esperados | crear y luego cinco comandos inválidos | `CREATED`, versión 1: ningún error escribió |

Los cinco comandos inválidos son: cobrar un monto distinto (400), usar una versión vieja (409), cerrar sin haber cobrado (400), crear otra vez el mismo id (409) y operar sobre un id que no existe (404).

Cada línea que imprime el script dice qué se pidió, qué respondió la API y en qué versión y estado quedó la transacción. Al final le pregunta a la History API por cada transacción y muestra una tabla con el estado reconstruido y la lista de eventos. La columna `ok` dice `sí` cuando el estado que reconstruye la History API, solo leyendo los eventos, es el mismo al que llegó la Transaction API. Esa tabla es la evidencia de que el Event Sourcing funciona: el estado no se guardó en ningún lado, se volvió a calcular.

Los ids llevan un sufijo distinto en cada corrida (por ejemplo `demo-feliz-mgx1k2`), así que puedes ejecutar el script varias veces sin chocar con datos anteriores.

Para correrlo contra el ambiente desplegado, indica las direcciones:

```powershell
$env:API_URL = "https://mi-servidor:3000"
$env:HISTORY_URL = "https://mi-servidor:3001"
npm run simular
```

Si algo no responde como se esperaba, el script lo lista al final y termina con error.

### La colección de Postman

En `postman/event-sourcing.postman_collection.json` está la misma historia en forma de requests. Impórtala en Postman (**Import** y eliges el archivo). Tiene cuatro carpetas:

1. **Camino feliz**: crea, cobra, aprueba y cierra; luego consulta en la History API el estado y los eventos.
2. **Rechazo y reintento**: el recorrido largo, con el motivo del rechazo y el intento 2.
3. **Errores esperados**: los cinco comandos inválidos, y una consulta final que comprueba que el historial sigue con un solo evento.
4. **Consultas**: el listado de las dos APIs.

No hace falta copiar ids ni versiones. Cada request guarda el `transactionId` y la versión que devolvió, y el siguiente los usa. Cada uno trae pruebas, así que en la pestaña **Test Results** se ve en verde lo que tenía que pasar. Para recorrer una carpeta completa de una vez, usa **Run folder**.

Las direcciones están en las variables de la colección, `apiUrl` y `historyUrl`. Cámbialas para probar el ambiente desplegado.

## Monitoreo con Grafana Cloud

Las dos APIs pueden mandar trazas, métricas y logs a Grafana Cloud por OTLP, sin instalar un collector. Si no configuras nada, no envían nada y funcionan igual que siempre.

Copia `.env.example` como `.env` en esta carpeta y completa dos valores que da Grafana en **Connections → OpenTelemetry (OTLP)**:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 de instanceId:token glc_>
```

Sin comillas, con `Basic%20` (no un espacio) y con el endpoint terminado en `/otlp`. El `.env` está en `.gitignore`: el token nunca se sube al repositorio.

Después de guardar, reinicia las dos APIs. Un proceso que ya estaba encendido no lee el archivo de nuevo. En Grafana aparecen como `eventsourcing-transaction-api` y `eventsourcing-history-api`, con `deployment.environment=local`:

- Trazas: **Explore → Tempo**.
- Logs: **Explore → Loki**.
- Métricas: **Explore → Mimir/Prometheus**.

La Transaction API también expone `POST /otlp/v1/{traces|metrics|logs}`. El frontend manda ahí su telemetría y la API la reenvía a Grafana con el token del servidor, así el navegador nunca ve la clave.

### Comprobar la conexión

Con la Transaction API y el frontend encendidos y el `.env` completo en los dos:

```bash
npm run probar:otlp
```

Manda una traza y un log mínimos por el reenvío de la API y por el proxy de Vite, y dice qué significa cada respuesta: `200` llegó a Grafana, `401` el token está mal copiado, `404` el proceso arrancó sin el `.env` (hay que reiniciarlo), `502` no se alcanzó Grafana. No imprime el token. Si usas otros puertos: `API_URL=http://localhost:3010 FRONT_URL=http://localhost:5174 npm run probar:otlp`.

El botón "Test connection" del asistente del collector de Grafana se queda en "No metrics were found": es normal, porque aquí no hay collector; las apps mandan directo al gateway. Pyroscope también queda vacío, porque no se mandan perfiles.

En Docker el `.env` no se copia dentro de la imagen. `docker compose` lo inyecta al arrancar las dos APIs. Ese archivo no debe incluir `OTEL_SERVICE_NAME` ni `PORT`: el Compose fija el puerto y el nombre de cada servicio (`eventsourcing-transaction-api` y `eventsourcing-history-api`).

### Qué logs llegan a Loki

Todo lo que las APIs escriben en la consola también se manda a Loki, con su nivel (`INFO`, `WARN`, `ERROR`). Algunos logs llevan además campos propios, que en Loki aparecen como metadatos y se pueden filtrar:

| Log | Nivel | Campos |
| --- | --- | --- |
| Cada evento agregado al event store | `INFO` | `event_type`, `event_version`, `event_id`, `transaction_id` |
| Cada comando (`POST`) que la API rechaza, con el motivo | `WARN` | `http_status_code`, `reason`, `transaction_id`, `http_path` |
| Cada request HTTP de las dos APIs | `INFO` (`ERROR` si es 5xx) | `http_method`, `http_path`, `http_status_code`, `duration_ms` |
| Errores no capturados del navegador | `ERROR` | `error.type` (servicio `eventsourcing-fe`) |

Los logs que se escriben durante un request quedan ligados a su traza: desde un log en Loki se puede saltar a la traza en Tempo.

### El dashboard

En `grafana/dashboard-eventsourcing.json` hay un dashboard listo. En Grafana: **Dashboards → New → Import**, sube el archivo y, cuando pregunte por las fuentes de datos, elige las de tu stack: para **Loki** la de logs (`grafanacloud-<stack>-logs`) y para **Prometheus** la de métricas (`grafanacloud-<stack>-prom`). Muestra:

- Totales: eventos registrados, pagos rechazados, transacciones completadas y comandos rechazados.
- Eventos por tipo y comandos rechazados por código HTTP, a lo largo del tiempo.
- El historial de una transacción: escribe un `transactionId` en el campo de arriba y aparecen sus eventos en orden, como en la History API, pero contados por los logs.
- Los eventos agregados, los rechazos y errores, y los requests HTTP.
- Métricas de Prometheus: requests por segundo y latencia p95 de cada API.

### Demo con Grafana

1. Con el `.env` completo, enciende las dos APIs y ejecuta `npm run simular`. Espera un minuto: Grafana tarda un poco en recibir los datos.
2. Abre el dashboard. Los totales y las barras de "Eventos por tipo" ya muestran las transacciones de la simulación.
3. Copia del resultado del script el id del escenario con reintento (`demo-reintento-...`) y pégalo en el campo `transactionId`. Se ven los seis eventos, del `TransactionCreated` al `TransactionCompleted`.
4. En "Comandos rechazados y errores" están los cinco comandos inválidos del escenario de errores, cada uno con su motivo (monto distinto, versión vieja, transición inválida, id repetido, id inexistente).
5. Para buscar a mano, en **Explore → Loki**:

```logql
{service_name="eventsourcing-transaction-api"} | event_type="PaymentRejected"
{service_name="eventsourcing-transaction-api"} | transaction_id="demo-reintento-..."
{service_name=~"eventsourcing-.*"} | severity_text="WARN"
sum by (event_type) (count_over_time({service_name="eventsourcing-transaction-api"} | event_type!="" [5m]))
```

6. En **Explore → Tempo**, busca el servicio `eventsourcing-transaction-api` y abre una traza de `POST /transactions/{id}/request-payment`: se ve cuánto tardó y, desde ahí, sus logs.

## Cómo comprobar que todo sigue en pie

```powershell
npm test
```

Ejecuta las pruebas del dominio, de la Transaction API y de la History API, incluyendo las que llaman a la pantalla y a los endpoints de historial. Cada prueba usa un archivo temporal. Tu `data/event-store.jsonl` de la demo no se toca.

## Etapa 5. Las tres piezas, juntas

Hasta aquí cada programa se encendía en su propia terminal. Esta etapa los deja en un solo `docker compose`: Transaction API, History API y el frontend. Grafana Cloud sigue afuera; no es un contenedor. Si el `.env` de esta carpeta está completo, Compose se lo pasa a las dos APIs al arrancar. El token no queda dentro de la imagen y no se sube al repositorio.

El archivo de eventos ya no es `data/event-store.jsonl` del disco. Vive en un volumen de Docker llamado `event-store`. La Transaction API lo monta en `/app/data` y escribe ahí. La History API monta el mismo volumen en `/data`, en solo lectura, y lee `/data/event-store.jsonl`. Si History se cayera y volviera a subir, seguiría viendo lo que Transaction ya escribió.

El navegador no usa los nombres internos de Docker. El frontend se construye apuntando a `http://localhost:3000` y `http://localhost:3001`, que son los puertos publicados en tu máquina. La telemetría del navegador sale hacia `http://localhost:3000/otlp/...` y la Transaction API la reenvía a Grafana.

Hace falta Docker Desktop (o Docker Engine con Compose v2). Desde `proyectoparadigmaeventsourcing`:

```powershell
npm run up
```

Eso construye las tres imágenes, las levanta y espera a que respondan. Cuando termina:

- Frontend: [http://localhost:5173/](http://localhost:5173/)
- Swagger: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- Pantalla simple de History: [http://localhost:3001/](http://localhost:3001/)

`npm run down` apaga los contenedores. El volumen se queda, así que el historial sigue ahí la próxima vez que hagas `npm run up`.

### Guion de la demo

Este es el orden para mostrar el trabajo de punta a punta. Calcula unos minutos la primera vez: las imágenes se construyen desde cero.

1. Confirma que el `.env` de esta carpeta tiene el endpoint y el token de Grafana, si quieres ver el dashboard. Sin ese archivo las APIs igual arrancan; solo no envían telemetría.
2. Ejecuta `npm run demo`. Levanta la plataforma, espera a que las tres direcciones respondan y corre la simulación de la etapa 4. Si la History API no responde, el script termina con error: ya no da la simulación por buena sin poder reconstruir el historial.
3. En la consola queda una tabla. Anota el id del escenario con reintento, algo como `demo-reintento-...`. Su estado esperado es `COMPLETED`, versión 6, dos intentos.
4. Abre [http://localhost:5173/](http://localhost:5173/). Busca ese id. Tienes que ver el estado reconstruido y, en orden, `TransactionCreated`, `PaymentRequested`, `PaymentRejected`, `PaymentRetried`, `PaymentApproved` y `TransactionCompleted`.
5. Abre también [http://localhost:3001/](http://localhost:3001/), pulsa **Actualizar lista** y elige la misma transacción. Es la misma lectura del archivo, en la pantalla simple de History. Swagger, en el puerto 3000, sirve si quieres mostrar un comando a mano.
6. Si el `.env` está completo, espera cerca de un minuto y abre el dashboard de Grafana. Pega el mismo id en `transactionId`. Los seis eventos aparecen otra vez, esta vez contados por los logs. El detalle de los paneles está en la sección de Grafana, más arriba.
7. Cuando termines, `npm run down`.

Si la plataforma ya está arriba y solo quieres repetir los escenarios, alcanza con `npm run simular`. Cada corrida crea ids nuevos.

### Publicar las imágenes

El Compose ya etiqueta las imágenes. Sin variable de entorno el nombre local es `eventsourcing/transaction-api:etapa5` (y lo mismo para `history-api` y `frontend`). Para dejarlas a nombre de tu usuario de Docker Hub:

```powershell
$env:DOCKERHUB_USER = "tu-usuario"
docker login
npm run publicar
```

`npm run publicar` construye y hace `docker compose push`. No hace falta inventar otro `docker build`. Sustituye `tu-usuario` por el usuario real de Docker Hub antes de ejecutarlo. Este repositorio no publica las imágenes por sí solo.

Si prefieres construir una imagen suelta, sin Compose:

```powershell
docker build -t eventsourcing/transaction-api:etapa5 .
docker build -f history/Dockerfile -t eventsourcing/history-api:etapa5 .
docker build -f ..\eventsourcingfrontend\Dockerfile -t eventsourcing/frontend:etapa5 ..\eventsourcingfrontend
```
