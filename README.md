# KikiriWeb

Gestión de estudiantes, tickets de pollada, entregas, anulaciones y cierre de caja con Next.js, React y Supabase.

## Instalación

Requiere Node.js 20.12 o superior.

1. Ejecuta `npm ci`.
2. Copia `.env.example` a `.env.local` y configura la URL y la clave pública de Supabase.
3. Ejecuta **todo `database.sql`** en el SQL Editor de Supabase. Sirve para una instalación nueva y para migrar la base existente; no borra estudiantes ni tickets.
4. Ejecuta `npm run dev` y abre http://localhost:3000.

## Migración de una instalación existente

Aplica `database.sql` antes de desplegar el código nuevo. La aplicación necesita las nuevas funciones SQL y las columnas `unit_price` y `movement_id`.

Antes de aplicarla, guarda un respaldo externo y prueba una copia de la base. La migración toma copias temporales de control, bloquea escrituras durante la comprobación y compara todos los campos originales antes de confirmar la transacción. Si detecta un cambio no previsto, cancela la migración completa. Las copias temporales se descartan al terminar y no sustituyen un respaldo recuperable. Las copias se crean explícitamente en `pg_temp`, activan RLS y revocan el acceso de `PUBLIC`, `anon`, `authenticated` y `service_role`. Las tablas principales también activan RLS inmediatamente después de su declaración. Si no puede obtener los bloqueos en 10 segundos, se cancela sin aplicar los cambios.

Conserva las políticas y el disparador existentes cuando son compatibles; ante una definición incompatible con el mismo nombre, se detiene para revisión. No cambia fechas, pagos ni asignaciones de tickets existentes: solo agrega su referencia al historial. Una entrega antigua sin fecha usa la fecha de creación únicamente para el nuevo movimiento; el ticket conserva su fecha original, incluso si es nula.

Supabase puede seguir mostrando una advertencia porque el archivo define la función de eliminación de estudiantes. La definición no ejecuta esa eliminación. Reemplaza el contenido anterior del editor y ejecuta el archivo completo, desde `BEGIN` hasta `COMMIT`, sin seleccionar bloques aislados ni agregar RLS automáticamente desde el diálogo del editor.

La migración activa RLS, elimina los permisos de escritura directa de las sesiones públicas y permite escribir solo mediante funciones autenticadas. Crea el historial de entregas existentes y registra cada entrega y anulación futura por separado. Las anulaciones anteriores que ya se borraron no se pueden reconstruir. El precio histórico inicial de los tickets existentes se considera S/15.

Los usuarios autenticados existentes operan como cajeros. Mantén desactivadas las altas públicas y el inicio de sesión anónimo en Supabase Auth si el sistema es de uso interno; las cuentas se crean desde administración. Esta versión no introduce roles de administrador separados.

## Comportamiento

- Los estudiantes se buscan y consultan con paginación.
- Entregas y anulaciones bloquean los tickets durante la transacción para evitar que dos cajeros sobrescriban la misma entrega.
- Las anulaciones requieren el identificador de la entrega original. Un ticket que fue anulado y vuelto a entregar no se puede anular desde una pantalla desactualizada.
- Los movimientos conservan el nombre del estudiante, números de ticket, precio y cajero. No se permite eliminar estudiantes o tickets que tengan historial.
- El cierre de caja y “Cobrado Hoy” incluyen las entregas que siguen activas en el día seleccionado, con límites de fecha de `America/Lima`. Las preventas no se vuelven a cobrar. Una anulación revierte la entrega; no registra un reembolso monetario independiente.
- El CSV separa efectivo y Yape, incluye el total y protege las celdas de texto frente a fórmulas de hojas de cálculo. `GET /api/export?date=AAAA-MM-DD` permite consultar otra fecha.

## Importación

Se aceptan comas o punto y coma, BOM, campos entre comillas, comillas escapadas y saltos de línea dentro de campos. La vista previa y el servidor usan el mismo lector y las mismas validaciones.

```csv
nombre,codigo,dni,ticket_inicio,ticket_fin
Juan Pérez,2026-001,12345678,1,15
```

También se acepta `nombre,tickets`, con una lista como `"1;2;3"`. Se reconocen los encabezados `Nombres;Inicio;Fin`. Código y DNI son opcionales. El DNI, cuando se proporciona, debe tener ocho dígitos.

Límites: 2 MB, 1000 estudiantes, 2000 tickets por estudiante y 10 000 tickets por archivo. El archivo completo se importa en una transacción: si una fila falla, no se guarda ninguna. Volver a importar tickets existentes produce un conflicto y conserva los datos anteriores.

## Administración

Las credenciales se leen de `.env.local`. No se incluyen secretos ni contraseñas en los scripts ni se imprimen en consola.

Para crear una cuenta, configura `SUPABASE_SECRET_KEY`, `AUTH_USER_EMAIL` y `AUTH_USER_PASSWORD` y ejecuta `npm run create-user`. Se requiere una contraseña de al menos 12 caracteres. El comando anterior `node scripts/add_yesii.mjs` usa ahora esas mismas variables.

Para cargar un CSV con una cuenta existente, configura su correo y contraseña y ejecuta:

```sh
npm run seed -- semilla.csv
```

El seed valida el archivo y usa la misma importación transaccional. No elimina datos ni crea cuentas automáticamente.

Si había una clave secreta activa en versiones locales anteriores, rótala en Supabase y actualiza los servicios que la utilizan. Retirarla del archivo no revoca su acceso. La aplicación web solo necesita la clave pública.

## Comprobaciones

```sh
npm test
npm run lint
npm run build
npm audit
```

Las pruebas de SQL usan PostgreSQL en memoria mediante PGlite, sin conectarse a Supabase. Verifican RLS, permisos, transacciones, colisiones de tickets, entregas duplicadas, anulaciones, límites de fecha y migraciones repetidas. Las pruebas de API comprueban el rechazo de solicitudes sin sesión y la propagación de conflictos. La compilación verifica la integración con Next.js.


## Diseño y conservación de la búsqueda

La aplicación usa modo claro en todas las pantallas, con fuentes locales. El texto del buscador y la página de resultados se conservan por pestaña en `sessionStorage`, de forma independiente para Panel, Estudiantes y Movimientos. Cerrar sesión explícitamente limpia estas búsquedas.

El Panel consulta actualizaciones cada 30 segundos sin recargar la ventana. La actualización automática se pausa mientras hay un campo de texto activo, una selección de tickets, una operación de entrega o un diálogo abierto, y cuando la pestaña no está visible. “Actualizar” permite consultar datos manualmente sin perder la búsqueda o la selección. Las respuestas de búsquedas anteriores se descartan.

Una sesión vencida intenta renovarse una vez. Si necesita credenciales, muestra un acceso dentro de la pantalla y conserva la búsqueda y la selección; las API siguen exigiendo una sesión válida.

Para las pruebas de interacción, ejecuta `npm run build` y después `npm run test:ui`. Usan Chrome instalado (o el canal indicado con `PLAYWRIGHT_CHANNEL`), páginas compiladas y respuestas ficticias. No acceden a los datos ni a la autenticación real de Supabase. Las capturas de revisión se guardan en `artifacts/ui-preview`.


## Arranque en Windows, OneDrive y Dropbox

`npm run dev` prepara `.next-dev`; `npm run build` prepara `.next`. Antes de reiniciar desarrollo, deten su servidor con Ctrl+C para evitar limpiar archivos que siga usando. Las carpetas de desarrollo y produccion son independientes.

La preparacion elimina solamente el contenido generado de la carpeta correspondiente y conserva la carpeta raiz. Rechaza enlaces y junctions para impedir que la limpieza alcance otra ubicacion. No modifica codigo fuente, credenciales ni datos de Supabase.

En Windows, si el proyecto esta dentro de Dropbox, marca solo `.next-dev` o `.next` con el atributo `com.dropbox.ignored` antes de que Next.js genere sus archivos. La marca se conserva entre arranques, de modo que los manifiestos y el cache quedan locales. Es el mecanismo documentado por [Dropbox](https://help.dropbox.com/sync/ignored-files); `.gitignore` por si solo no excluye archivos de Dropbox. Si la carpeta contiene archivos solo en linea y Dropbox no permite ignorarla, el comando se detiene y pide hacerla disponible sin conexion.

Esta preparacion evita reutilizar archivos generados incompletos y reduce interferencias de sincronizacion como `EINVAL: readlink` o `UNKNOWN: open pages-manifest.json`. Si persisten los bloqueos del proveedor, usa una copia de trabajo fuera de la carpeta sincronizada.

Las capturas y resultados de Playwright quedan en `artifacts/`, fuera de los directorios de Next.js y excluidos de Git. Ejecuta `npm run build` antes de `npm run start` o `npm run test:ui`.


## Padrón de la facultad y reparto de tickets

La nueva pantalla **Reparto** permite buscar por código o por palabras del nombre y apellidos (con o sin tildes), filtrar de I a X semestre, agregar alumnos ausentes y corregir sus datos o semestre. Los estudiantes sin semestre confirmado se muestran al final. También se puede editar desde Estudiantes. Se usan las mismas cuentas autorizadas del sistema; la página y todas sus API requieren sesión.

Para una instalación nueva, ejecuta primero `database.sql`. Para actualizar una instalación existente, ejecuta `supabase/migrations/20261031_faculty_distribution.sql` en SQL Editor de Supabase. Es una migración aditiva; no elimina alumnos, tickets, pagos ni movimientos. Si detecta códigos repetidos anteriores, se detiene para que puedan revisarse sin fusionar registros automáticamente.

Después se puede importar el CSV desde **Reparto → Importar padrón**. Admite las columnas `Código;Nombres;Apellidos;Escuela Profesional;Semestre` y archivos UTF-8 o Windows-1252 de hasta 2 MB y 1000 estudiantes. Los códigos se conservan como texto, incluidos los ceros iniciales. La importación agrega códigos nuevos y conserva los datos ya registrados, incluidas las correcciones manuales; no crea tickets. Los alumnos antiguos sin código no se fusionan por coincidencias de nombre: revisa esos perfiles y completa su código antes de importar si corresponden a personas del padrón.

Para preparar el archivo recibido, ordenarlo y generar una instalación privada con sus datos:

```sh
npm run prepare:faculty -- Lista_FInesi.csv
```

Se generan `artifacts/faculty-roster/Lista_FInesi_ordenada.csv`, `resumen.json` y `instalar_reparto_y_padron.sql`. Este último combina la migración y la carga de códigos nuevos para ejecutarlo como administrador en Supabase. No ejecuta cambios remotos por sí mismo. El CSV original y todos estos archivos privados quedan fuera de Git. Las etiquetas de escuela del archivo se conservan; pueden corregirse al editar.

Para repartir, selecciona un estudiante y escribe números separados por comas, espacios o punto y coma; también puedes usar rangos como `1050, 1052, 1060-1065`. Revisa el lote y confirma. Se usan números nuevos: cualquier número ya registrado, incluso como extra, cancela todo el lote. La unicidad se comprueba en PostgreSQL para proteger asignaciones simultáneas. Cada lote conserva encargado, fecha y los datos del estudiante al asignarlo; la edición posterior no cambia esa constancia. La asignación deja los tickets pendientes y sin pagar. El pago y el recojo se registran después mediante el Panel. Los perfiles con asignaciones se conservan y no pueden eliminarse.

Al editar, una versión del registro evita que un encargado sobrescriba los cambios que otro guardó mientras tenía abierto el formulario. Si aparece ese conflicto, actualiza el padrón y abre nuevamente el editor. Las búsquedas se conservan por pestaña y no hay recargas automáticas en la pantalla de reparto.


### Promoción

El padrón incluye la categoría **Promoción**, independiente de I-X semestre y de los estudiantes con semestre pendiente. Se puede filtrar por ella y seleccionarla en el editor. Internamente se almacena como `semester = 11`.

Para actualizar una instalación existente, ejecuta `supabase/migrations/20261031_promotion_category.sql`. Para clasificar el grupo inicial, ejecuta después `supabase/operations/assign_initial_promotion.sql`. Este último comprueba que hay exactamente 35 estudiantes sin semestre y ninguna Promoción antes de cambiarlos; si la situación no coincide, se detiene sin modificar estudiantes. Una segunda ejecución con los 35 ya clasificados no cambia registros nuevos sin semestre.

`npm run prepare:faculty -- Lista_FInesi.csv` prepara también `artifacts/faculty-roster/asignar_promocion.sql`, que combina ambos pasos en una sola transacción. Usa este archivo en Supabase para actualizar los 35 registros existentes; no hace falta volver a cargar el padrón. La operación conserva códigos, nombres, tickets, pagos e historial.


### Unificar copias del padrón con los perfiles de Promoción

`npm run prepare:dedup -- datos_import.csv Lista_FInesi.csv` compara los archivos privados de los 35 registros iniciales y la facultad. Solo propone coincidencias únicas del nombre y apellidos completos, ignorando orden, tildes, mayúsculas y puntuación, pero conservando la diferencia entre N y Ñ y las palabras repetidas. No elimina por nombres parciales ni por similitud aproximada. Los archivos actuales tienen 34 coincidencias completas (30 de X y 4 de IX); un estudiante inicial no figura en el padrón.

Se generan archivos privados en `artifacts/faculty-roster/`:

- `reporte_duplicados_promocion.csv` y `resumen_duplicados.json`: comparación de los archivos locales.
- `revision_duplicados_promocion.sql`: consulta sin escrituras para contrastar el reporte con la base actual.
- `unificar_duplicados_promocion.sql`: operación transaccional para ejecutar como administrador en Supabase. Vuelve a comprobar nombres, códigos, DNI, unicidad y relaciones en ese momento. Requiere los 35 perfiles clasificados como Promoción.

La unificación conserva el ID, el nombre y la categoría de Promoción. Completa su código, DNI o escuela solo cuando faltan. Si la copia ya tiene tickets o constancias de reparto, conserva sus IDs y todos sus datos y cambia únicamente el vínculo al perfil conservado. Los movimientos, fechas, pagos y las instantáneas originales de las constancias permanecen intactos. Después elimina la copia que no pertenece a Promoción.

Antes de cada eliminación, guarda la ficha de ambos perfiles y las relaciones originales en `public.student_deduplication_log`, con RLS y sin acceso para usuarios de la aplicación. El código transferido permite buscar al alumno y evita que una nueva importación vuelva a crear su copia. Las coincidencias ambiguas o con códigos/DNI contradictorios se dejan para revisión. Una relación adicional no contemplada o un cambio inesperado en los datos cancela toda la transacción. Ejecutarlo de nuevo no vuelve a modificar las unificaciones ya completadas.

Los scripts solo generan archivos; no conectan ni aplican cambios en Supabase. El reporte local no garantiza que la base remota siga teniendo los mismos nombres: las consultas generadas validan el estado vigente al ejecutarse.


## Modulos activos

`lib/module-mode.mjs` mantiene activos Reparto, Entregas y Movimientos. El acceso inicial lleva a Reparto; el menu permite abrir Entregas y ambos historiales. Estudiantes, Extras e Importacion anteriores permanecen bloqueados. El alta, edicion e importacion del padron se realizan dentro de Reparto.

Las API anteriores responden 423 para sesiones autorizadas, antes de consultar o modificar datos. Las sesiones sin autenticar siguen recibiendo 401. Para completar el bloqueo directo de RPC y habilitar la consulta del historial, ejecuta `supabase/migrations/20261031_distribution_only_history.sql` en Supabase. Se prepara una copia en `artifacts/faculty-roster/activar_solo_reparto.sql`; no vuelve a importar estudiantes ni modifica datos anteriores. La migración revoca todos los overloads de las funciones anteriores para PUBLIC, anon y authenticated, manteniendo las funciones del reparto. Debe aplicarse después de las migraciones iniciales.

**Historial de asignaciones** muestra el lote, estudiante y código al asignar, sus tickets, encargado y fecha/hora de Lima. Permite buscar por ticket, nombres, código, correo o referencia, filtrar por fechas y grupo, y navegar por páginas. Una búsqueda por ticket conserva el lote completo. Los datos históricos no se reemplazan por ediciones posteriores del padrón; se muestra el nombre actual si cambió. No se fabrican asignaciones para tickets antiguos sin constancia registrada.

Las implementaciones de entrega y sus pruebas se conservan para reactivarlas posteriormente. Las pruebas de navegador de entregas se omiten mientras esté activo este modo; las de bloqueo, Reparto e historial continúan activas. Para reactivar entregas se debe cambiar la fase y restaurar expresamente sus permisos de ejecución en Supabase.

Desarrollo y producción usan carpetas distintas: `npm run dev` limpia y usa `.next-dev`; `npm run build` limpia y usa `.next`. Así un servidor de desarrollo activo no comparte sus manifiestos con una compilación de producción.


### Cuentas de repartidores

El comando `npm run create-distributors -- --prepare` prepara dos contraseñas iniciales independientes de 16 caracteres en `artifacts/distributor-accounts/credenciales_iniciales.json`, a partir de los nombres y correos de `repartidores.json` en esa misma carpeta. Los archivos quedan fuera de Git y las contraseñas no se imprimen en consola. Preparar el archivo no crea usuarios ni envía correos.

Para crear las cuentas, configura `SUPABASE_SECRET_KEY` en `.env.local` (también se admite `SUPABASE_SERVICE_ROLE_KEY`) y ejecuta `npm run create-distributors`. Usa la API administrativa de Supabase, guarda el nombre en `user_metadata.full_name` y la etiqueta `app_metadata.system_role = distributor`, y permite acceso con la contraseña inicial sin enviar invitaciones. En la fase actual las cuentas operan en Reparto; los módulos de entregas permanecen bloqueados.

El script revisa todas las cuentas existentes antes de crear ninguna. No reemplaza cuentas ajenas ni cambia contraseñas existentes. Un identificador de lote permite reanudar si falla la segunda creación o la escritura del estado. `estado_cuentas.json` registra cuáles se crearon y sus IDs, sin contraseñas. Las claves administrativas solo se usan en este comando local; no se añaden al navegador ni a una API pública.

En cada ficha del padrón de Reparto, **Editar datos** abre el formulario de nombre, código, semestre y escuela. También está disponible en el panel del estudiante seleccionado. Guardar conserva los tickets asociados.


### Participantes y cambios de tickets (3 de noviembre)

Ejecuta `supabase/migrations/20261103_recipient_ticket_changes.sql` en SQL Editor despues de las migraciones anteriores. La copia local `artifacts/faculty-roster/actualizar_participantes_y_tickets.sql` contiene la misma migracion. El deploy de la aplicacion no ejecuta SQL; la clave administrativa de Auth tampoco permite aplicar migraciones. El padron conserva la consulta anterior si todavia falta el nuevo RPC, y las nuevas escrituras esperan la activacion de la base.

El tipo de participante es independiente del semestre: Estudiante, Externo o Docente. Los externos y docentes admiten codigo vacio y no reciben semestre. Los perfiles anteriores permanecen como estudiantes, con su semestre o Promocion intactos. El buscador y los filtros aparecen antes de las metricas y del panel de asignacion tambien en movil.

En **Tickets asignados / Ver y editar**, cada ticket permite corregir su numero, reasignarlo buscando otra persona o retirarlo. La correccion conserva el ID. El retiro deja `is_available = true`, sin propietario y sin borrar el ticket; puede asignarse nuevamente con su numero y conserva el mismo ID. Reasignar genera una constancia para el nuevo destinatario. Los lotes originales permanecen intactos. Los tickets pagados, entregados o con cualquier movimiento de entrega, incluidas anulaciones, estan protegidos. Cada operacion bloquea las filas y comprueba la version para rechazar formularios desactualizados; una colision cancela toda la operacion.

Los triggers de `students` y `tickets` guardan cada alta, modificacion o eliminacion en `faculty_changes`, incluidos los cambios de una importacion. Registran usuario y correo de la sesion, fecha, valores anteriores y posteriores. No aceptan un actor enviado por el navegador. Datos y auditoria se confirman en la misma transaccion: si falla el registro del cambio, se cancela la escritura. Los operadores solo pueden leer esta tabla. Las acciones administrativas sin una sesion de usuario se muestran como Sistema / SQL. No se inventan autores para los cambios anteriores a esta activacion.

**Historial / Cambios de fichas y tickets** permite consultar estos registros por persona, numero anterior o nuevo y usuario, con fechas de Lima y paginacion. Entregas excluye tickets disponibles sin asignacion y participantes o tickets eliminados.


### Exportar participantes y tickets

En Reparto, **Exportar CSV** descarga todo el padron actual, independientemente de la busqueda, filtros o pagina visibles. En movil se muestra el icono de descarga. El archivo tiene una fila por participante, incluidos estudiantes, Promocion, externos, docentes y quienes no tienen tickets. Incluye ID, nombre, codigo, DNI, categoria, semestre, escuela, cantidad y numeros de tickets asignados, fecha de modificacion de la ficha en Lima y el usuario de esa modificacion.

La exportacion refleja la asignacion actual: un ticket retirado no figura en su anterior propietario; uno reasignado figura con su destinatario actual. Los tickets disponibles sin propietario no se incluyen. Las asignaciones anteriores y el historial siguen consultandose en la aplicacion. Se leen ambas tablas por paginas completas, sin limitarse a la pantalla ni truncar los tickets de una persona. Un error interrumpe la descarga en vez de generar un archivo parcial. El CSV usa UTF-8 con BOM, comillas y proteccion contra formulas de hojas de calculo. La ruta requiere sesion autorizada, no guarda cache publica y no necesita otra migracion.


### Totales en Reparto

Las tres tarjetas principales muestran el total de participantes, participantes sin tickets y tickets repartidos. Son totales de todo el padron, independientes de la busqueda y de los filtros. Los tickets se cuentan por su propietario actual, incluidos los anteriores de Promocion aunque no tengan una constancia de reparto nueva. Una reasignacion no duplica el total; retirar una asignacion deja ese ticket fuera de los repartidos hasta volver a asignarlo. No se suman movimientos historicos ni se limita el total a la pagina visible. El conteo exacto de tickets se actualiza junto con el padron al guardar o actualizar y no requiere migracion adicional.


### Consultas y filtros de tickets (4 de noviembre)

En Reparto se pueden combinar **Sin tickets**, **Con tickets** o **Todos** con nombre/codigo, semestre, Promocion y categoria de participante. **Limpiar filtros** vuelve al padron completo. Los filtros se aplican en la base antes de paginar; los totales principales siguen siendo globales. Cambiar filtros o actualizar conserva la persona seleccionada y los numeros que aun no se han asignado.

Ejecuta `supabase/migrations/20261104_directory_performance.sql` despues de la migracion de participantes del 3 de noviembre. Hay una copia identica en `artifacts/faculty-roster/optimizar_consultas_y_filtros.sql`. Agrega una funcion de lectura con permisos para operadores autenticados, sin modificar participantes, tickets, pagos ni historial. Puede ejecutarse de nuevo. Las consultas anteriores siguen disponibles; si aun falta la migracion, la aplicacion conserva la consulta general y avisa que los filtros de tickets requieren activacion.

El nuevo RPC calcula una sola vez los tickets por propietario y reutiliza el resultado para los filtros y los totales. Entrega listado, conteos y categorias en una llamada y una misma consulta SQL, sin contar lotes historicos ni consultar aparte el total de tickets. La revision de protecciones de edicion solo se aplica a los tickets de la pagina visible; se conservan todos los tickets de cada persona. Usa los indices ya existentes de propietario y movimientos, sin agregar indices redundantes.

La espera de 250 ms se aplica solo mientras se escribe; abrir el padron y cambiar filtros o pagina inicia la consulta inmediatamente. Las busquedas anteriores se cancelan tambien en la solicitud a Supabase y sus respuestas no reemplazan las mas recientes. No se agregan recargas de pagina ni cache compartida con datos personales. La cabecera `Server-Timing` informa el tiempo de la consulta del directorio para comparar su comportamiento en produccion; no incluye la autenticacion ni el viaje de red desde el navegador.


### Avance de reparto por semestre

Los filtros de Reparto se organizan en grupo de participantes, semestres y estado de asignacion. Cada semestre muestra su total de alumnos, una barra y el porcentaje que tiene al menos un ticket: alumnos con tickets / total de alumnos del semestre x 100. Una persona con varios tickets cuenta una sola vez. Promocion y las otras categorias muestran tambien su cobertura cuando tienen participantes. Un grupo vacio muestra un guion, sin dividir por cero. En celular, el grupo se elige desde un selector compacto y los diez semestres permanecen visibles.

Ejecuta `supabase/migrations/20261104_semester_progress.sql` despues de la optimizacion anterior. La copia `artifacts/faculty-roster/activar_avance_por_semestre.sql` tiene el mismo contenido. Solo actualiza la funcion de lectura para agregar `withTickets` y `withoutTickets` a cada semestre y categoria, reutilizando el conteo existente en la misma llamada. No modifica datos ni crea tablas o indices. El avance usa siempre el grupo completo, independientemente de busqueda, pagina y filtro de tickets, y se actualiza al guardar o actualizar el padron. Si la consulta anterior todavia no devuelve esos campos, se muestra avance no disponible en lugar de un porcentaje inventado.


### Resultados de busqueda en movil

Al escribir un nombre o codigo en Reparto, las pantallas de hasta 1000 px muestran los resultados inmediatamente debajo del buscador, antes de filtros, porcentajes, resumen y panel de asignacion. Conservan las acciones de editar/asignar y la paginacion. Al limpiar la busqueda vuelve la distribucion habitual. La pantalla utiliza la misma consulta y conserva la persona seleccionada y el borrador de tickets; no agrega solicitudes ni cambia datos. En escritorio los resultados conservan su ubicacion en el espacio de trabajo.


### Pagos al instante y eliminaciones con historial

Todas las cuentas autenticadas, incluidos los repartidores, pueden eliminar participantes o tickets asignados y registrar pagos. En cada lote se elige Pendiente de pago, Efectivo o Yape; el medio se aplica a todos los tickets del lote. La asignacion y sus pagos se confirman en una sola transaccion. Para pagar una parte, asigna los numeros pagados en un lote separado. Los tickets anteriores tambien admiten Registrar pago desde su editor.

Un ticket pagado exige **Anular pago** antes de eliminarlo, y un participante no se puede eliminar mientras tenga tickets pagados. Las anulaciones y eliminaciones piden confirmacion. El pago usa el precio guardado en la base, registra importe, medio, fecha y usuario, y no cambia el estado de recojo. Una anulacion conserva el cobro original y agrega su reverso en `faculty_payments`; no borra registros ni inventa fechas para pagos antiguos. Si un pago anterior no tiene evento original, su anulacion queda marcada como legado y conserva la instantanea disponible.

Eliminar retira la ficha del padron activo y marca sus tickets como eliminados, conservando filas, IDs, auditoria y constancias originales. Los tickets sin historial de entrega pueden reutilizarse con el mismo ID; los que ya tuvieron entregas conservan reservado su numero. Eliminar un participante comprueba la version de su ficha y de todos sus tickets: otra asignacion, pago o edicion obliga a actualizar antes de continuar. Las fichas activas mantienen codigos unicos; el alta manual puede reutilizar el codigo de una ficha eliminada, mientras una importacion general respeta las eliminaciones anteriores.

Para activar, ejecuta `supabase/migrations/20261105_distribution_payments_deletion.sql`; hay una copia identica en `artifacts/faculty-roster/activar_pagos_y_eliminaciones.sql`. Requiere las migraciones anteriores, incluida la de avance por semestre. La migracion agrega columnas, la tabla protegida de pagos y funciones transaccionales; ajusta el indice de codigos a las fichas activas. No elimina registros ni cambia pagos anteriores. No otorga escrituras directas sobre las tablas a los clientes: todas las funciones verifican sesion, y los autores provienen del JWT, no del navegador.

La instalacion conserva una copia temporal privada de cada fila existente y compara todos sus campos antes de `COMMIT`, incluidos propietario y numero de cada ticket, pagos y constancias de asignacion. Si detecta un cambio, cancela toda la transaccion. Al terminar muestra asignaciones, tickets y participantes antes y despues. La advertencia del editor puede permanecer porque se reemplaza el indice de codigos; instalar las funciones de eliminacion no las ejecuta. Las eliminaciones posteriores requieren la accion manual y la confirmacion en la aplicacion.

El historial identifica el numero del ticket, pagos, anulaciones y eliminaciones con sus valores anteriores y posteriores y el usuario. El CSV incluye solo participantes y tickets activos, y agrega pagados, pendientes, numeros por medio e importe pagado. Los totales y porcentajes del padron excluyen los eliminados y siguen basados en la asignacion actual. El historial de lotes conserva las asignaciones historicas completas.

Entregas excluye los eliminados y respeta los pagos previos de Reparto y sus reversos. No vuelve a cobrar un ticket pagado ni trata una anulacion de recojo como anulacion del pago.

Desde el historial de asignaciones, Editar / pagos abre los tickets que siguen activos en el lote y usa los mismos pagos, anulaciones y correcciones auditados de Reparto. Consulta por ID de lote y ticket actual, sin modificar las instantaneas originales ni operar sobre numeros historicos que pudieron reutilizarse. No requiere otra migracion.

Los cobros de Reparto se conservan en faculty_payments y en el estado del ticket. La caja activa usa delivery_stats y separa saldo acumulado y neto diario, resta anulaciones y evita contar otra vez un pago al entregar. ticket_stats es una funcion antigua revocada y no se usa para la caja actual.

## Asignacion en modal y pagos conjuntos

La accion Asignar tickets abre un dialogo en escritorio y movil. Cerrar o pulsar Escape conserva el buscador y el borrador de la misma persona. Al cambiar de persona se limpia el borrador para evitar asignarlo al destinatario anterior.

En los tickets existentes de Reparto y en el historial, Pagar varios tickets permite seleccionar parte o todos los tickets pendientes, ver la suma y confirmar un pago conjunto en efectivo o Yape. La condicion Pendiente de pago anula los pagos seleccionados con confirmacion; no elimina asignaciones ni eventos anteriores. Los tickets ya pagados no se cobran otra vez y los ya pendientes no generan movimientos vacios.

Requiere ejecutar completo supabase/migrations/20261106_batch_ticket_payments.sql (copia privada: artifacts/faculty-roster/activar_pagos_en_grupo.sql). Instalar la funcion no ejecuta pagos y compara las filas existentes antes de confirmar la migracion. La operacion conjunta bloquea y verifica todos los tickets y sus versiones antes de mutar, comprueba el total contra los precios guardados y conserva importes originales al anular. Cualquier error revierte pagos, auditoria y estado del grupo completo. Entregas utiliza el mismo registro de pagos.

## Entregas habilitadas y caja preservada

Entregas y Movimientos funcionan junto a Reparto; el inicio de sesion mantiene Reparto como pagina inicial. La administracion antigua (Estudiantes, Extras e Importar anteriores) permanece bloqueada y sus RPC de escritura siguen revocados. Los participantes y tickets se administran desde Reparto.

Ejecutar completo supabase/migrations/20261110_enable_deliveries.sql (copia privada artifacts/faculty-roster/habilitar_entregas_y_caja.sql). La instalacion verifica que estudiantes, tickets, asignaciones, movimientos y pagos existentes conserven todas sus filas y campos. Agrega una base inmutable de pagos anteriores sin ledger, incluyendo sus anulaciones existentes. Los pagos de medio o fecha desconocidos se muestran separados y nunca se inventa un cobro de hoy.

La caja suma los pagos antiguos y los eventos de Reparto y Entregas, resta anulaciones de pago y separa acumulado de neto diario. Entregar un ticket ya pagado conserva metodo, fecha, autor e importe. En lotes mixtos solo se cobran los pendientes. Anular una entrega no anula su pago; una nueva entrega del mismo ticket no cobra otra vez. Versiones de tickets, propietarios activos y estados se verifican con bloqueos ordenados antes de cobrar o entregar. Cualquier error revierte el lote completo.

El CSV de caja exporta eventos monetarios con importes firmados, usuario, origen y fecha de Lima, junto con el resumen acumulado. El historial de entregas muestra solo el importe cobrado en cada entrega, sin sumar pagos previos otra vez.

Las cuentas nuevas de Entregas se provisionan con node scripts/create-delivery-users.mjs, a partir del plan privado artifacts/delivery-accounts/cuentas.json. Credenciales y estado permanecen en ese directorio ignorado; repetir el comando no rota claves ni reemplaza cuentas existentes.


## Prepagado sin nuevo cobro en Entregas

La confirmacion de entrega ofrece botones Efectivo, Yape y Prepagado. Prepagado sirve para confirmar que los tickets ya fueron pagados anteriormente: el cobro mostrado y registrado es cero y no aumenta caja, efectivo ni Yape. No cambia ningun pago que ya estaba registrado. Guarda el usuario, fecha, tickets e importe cero en el registro y en el historial; no inventa un ingreso anterior ni su medio o fecha. Anular una entrega conserva esa confirmacion y volver a entregar no cobra. Una anulacion explicita del estado Prepagado registra un reverso de cero, sin restar dinero a la caja.

Ejecutar completo supabase/migrations/20261110_prepaid_delivery.sql (copia identica artifacts/faculty-roster/activar_prepagado_entregas.sql) despues de habilitar Entregas. La instalacion solo ajusta dos reglas de validacion y las funciones; verifica todas las filas de estudiantes, tickets, asignaciones, movimientos, auditoria, pagos y saldo inicial antes de confirmar. No instala pagos ni entregas reales. La advertencia del editor puede aparecer por reemplazar restricciones, sin borrar filas. Solo Prepagado permite importe cero; los cobros efectivos siguen exigiendo importe positivo.
