# TRAZA · Match y trazabilidad de materiales

Frontend React + Vite para registrar órdenes, números de parte y SH, ejecutar el match contra documentos maestros y permitir la revisión del supervisor.

El proyecto funciona en **modo demo** cuando no existen variables de Supabase. Cuando `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` están configuradas, la aplicación utiliza Supabase Auth, las tablas de trazabilidad y las funciones RPC del esquema entregado.

## Funcionalidad conectada

La aplicación puede iniciar sesión con Supabase Auth, leer el perfil y el rol desde `public.perfiles_usuarios`, consultar registros históricos y documentos maestros, registrar capturas mediante `registrar_captura()`, confirmar o rechazar capturas mediante `confirmar_revision()` y cargar CSV/XLSX desde el navegador a `documentos_maestros` y `datos_referencia`.

Desde el botón del perfil, el usuario puede editar sus datos propios. Un administrador también puede ver usuarios, editar roles y estados, y crear nuevas cuentas sin cerrar su propia sesión.

La carga del archivo requiere que el usuario tenga rol `supervisor` o `administrador`. El archivo original se intenta guardar en el bucket privado `documentos-maestros`; si el bucket todavía no existe, la importación de filas puede continuar, pero se mostrará una advertencia sobre Storage.

La captura operativa utiliza el formato **Registro hora por hora**. Cada registro guarda SH, cantidad, orden x hora, piezas x hora, hora del servidor y la celda asignada al usuario. Las celdas válidas son `CELDA 16`, `CELDA 15`, `CELDA 11` y `CELDA 10`.

## Requisitos en Supabase

Ejecuta primero el script SQL incluido en el proyecto o el archivo entregado por separado:

```text
supabase/schema.sql
```

Después, crea usuarios en **Authentication → Users**. El trigger de la base de datos crea automáticamente su fila en `public.perfiles_usuarios` como `operador`.

Para promover un usuario a supervisor:

```sql
update public.perfiles_usuarios
set rol = 'supervisor'
where id = 'UUID_DEL_USUARIO';
```

Para promoverlo a administrador:

```sql
update public.perfiles_usuarios
set rol = 'administrador'
where id = 'UUID_DEL_USUARIO';
```

Si vas a cargar y conservar archivos originales, crea un bucket privado en **Storage** con el nombre exacto:

```text
documentos-maestros
```

No uses un bucket público para documentos de producción. Más adelante conviene agregar políticas de Storage que permitan a supervisores y administradores subir archivos, y que solo permitan descargar archivos mediante URLs firmadas.

## Migración del registro hora por hora

Si el esquema original ya está instalado, ejecuta una sola vez el archivo:

```text
supabase/hourly-register-migration.sql
```

La migración agrega `cantidad`, `orden_x_hora`, `piezas_x_hora` y `celda` a `registros_captura`, agrega la celda asignada a `perfiles_usuarios`, crea el catálogo de las cuatro celdas y reemplaza la RPC `registrar_captura` con una versión que obtiene la celda desde el perfil autenticado.

Un operador sin celda puede elegirla una sola vez en la pestaña **Registro hora por hora**. Después de esa selección el usuario queda bloqueado a esa celda. Únicamente un administrador puede cambiarla desde **Perfil → Ver usuarios → Editar**.

La hora no se acepta como dato editable del navegador: `fecha_hora_captura` continúa usando `now()` del servidor de Supabase.

## Variables locales

Copia el archivo de ejemplo:

```bash
cp .env.example .env.local
```

Completa:

```env
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=TU_PUBLISHABLE_KEY_O_ANON_KEY
```

Obtén los valores desde **Project Settings → API** en Supabase.

La llave anon o publishable puede aparecer en el frontend porque está diseñada para usarse con RLS. La protección real proviene de las políticas RLS y de las funciones RPC. **Nunca agregues `service_role`, una contraseña de base de datos ni una clave privada al frontend, a `.env.example` o a una variable `VITE_*`.**

Inicia el proyecto:

```bash
pnpm install
pnpm dev
```

Prueba el build:

```bash
pnpm check
pnpm build
```

## Variables en GitHub

Como el proyecto usa Vite, las variables se insertan durante el build. En el repositorio abre:

**Settings → Secrets and variables → Actions → Variables → New repository variable**

Crea estas dos variables:

| Nombre | Valor | Tipo recomendado |
|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase | Repository variable |
| `VITE_SUPABASE_ANON_KEY` | llave anon o publishable | Repository variable |

También puedes usar **Repository secrets** si tu organización lo exige. Sin embargo, al compilar una aplicación Vite estos valores terminan dentro del JavaScript público. La llave anon/publishable no debe considerarse un secreto de servidor y el `service_role` no debe usarse bajo ninguna circunstancia en este frontend.

Si el despliegue lo realiza una plataforma como Vercel, Netlify o Cloudflare Pages, registra las mismas dos variables en la configuración de Environment Variables de esa plataforma y selecciona los entornos `Production`, `Preview` y `Development` según corresponda.

## GitHub Pages

El repositorio incluye `.github/workflows/deploy-pages.yml`. En **Settings → Pages**, cambia **Build and deployment → Source** de `Deploy from a branch` a **GitHub Actions**. Si se deja `Legacy / main / root`, GitHub publicará este README en lugar de `dist/public`.

Después del cambio, ejecuta el workflow `Deploy TRAZA to GitHub Pages` desde **Actions → Deploy TRAZA to GitHub Pages → Run workflow**, o realiza un nuevo push a `main`. La URL pública será:

```text
https://jcanett1.github.io/HORA-POR-HORA-PXG-TEQUILA/
```

## Perfil y administración de usuarios

Para que el usuario pueda editar su propio perfil, ejecuta una vez:

```bash
supabase db push
```

o copia el contenido de `supabase/profile-update.sql` en el SQL Editor de Supabase y ejecútalo. Esta migración concede `UPDATE` y crea una policy que solo permite editar la fila cuyo `id` coincide con `auth.uid()`.

La creación y edición de usuarios Auth se realiza mediante la Edge Function `admin-users`, porque la llave `service_role` nunca debe llegar al navegador. Desde la raíz del repositorio:

```bash
supabase functions deploy admin-users --project-ref TU_PROJECT_REF
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY --project-ref TU_PROJECT_REF
```

Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_ANON_KEY` a la función. La `service_role` se configura solamente como secreto de la Edge Function y no como una variable `VITE_*`.

Después de desplegarla, el menú de perfil de un administrador mostrará:

```text
Editar mi perfil
Ver usuarios
Cerrar sesión
```

El menú de usuarios permite crear cuentas, cambiar `operador`, `supervisor` o `administrador`, activar/desactivar usuarios y actualizar planta, área y número de empleado.

## Flujo de conexión

El frontend no se conecta con una contraseña de PostgreSQL. Se conecta mediante el cliente oficial `@supabase/supabase-js` usando la URL del proyecto y la llave pública. Supabase Auth entrega el JWT de sesión. RLS utiliza `auth.uid()` para limitar las filas.

El flujo de captura es:

```text
Usuario autenticado
        ↓
registrar_captura()
        ↓
Documento maestro activo
        ↓
Match de Orden + Número de Parte + SH
        ↓
registros_captura
        ↓
confirmar_revision() por supervisor
        ↓
acciones_revision
```

El resultado automático y la confirmación del supervisor se mantienen separados. Una captura puede ser `coincide` y continuar como `pendiente` hasta que el supervisor confirme la salida.

## Archivos principales

| Archivo | Propósito |
|---|---|
| `client/src/lib/supabase.ts` | Crea el cliente Supabase solo cuando existen las variables. |
| `client/src/lib/database.types.ts` | Tipos principales del esquema usado por el frontend. |
| `client/src/lib/trace-data.ts` | Lectura, match RPC, importación de Excel/CSV y mapeo de registros. |
| `client/src/components/AuthGate.tsx` | Login y sesión Supabase Auth; modo demo sin variables. |
| `client/src/components/ProfileAndUsers.tsx` | Menú de perfil, edición propia y administración de usuarios. |
| `client/src/pages/Home.tsx` | Panel, captura, supervisión, documentos, reportes e historial. |
| `supabase/hourly-register-migration.sql` | Columnas, celdas, RPC y permisos del registro hora por hora. |
| `supabase/functions/admin-users/index.ts` | Edge Function protegida para listar, crear y editar usuarios Auth. |
| `supabase/profile-update.sql` | Policy RLS para actualizar el perfil propio. |
| `.env.example` | Plantilla de variables públicas necesarias para Vite. |

## Limitaciones actuales

La carga XLSX/CSV se procesa en el navegador y envía filas válidas a Supabase. Para archivos muy grandes conviene mover la importación a una Edge Function o a un servicio backend para aplicar límites, validación y control de errores con mayor robustez.

La pantalla de descarga del documento deja preparado el flujo, pero requiere agregar URLs firmadas de Supabase Storage. También se recomienda configurar políticas de Storage antes de usar documentos reales.

La lógica inicial considera una captura duplicada cuando la misma combinación se registra el mismo día. Si la operación permite repetir Orden + Número de Parte + SH para distintas cantidades, lotes o secuencias, agrega esos campos al modelo antes de usar el sistema en producción.

## Seguridad mínima antes de producción

Verifica que RLS esté activado en todas las tablas públicas. Usa únicamente el rol `service_role` en un backend seguro o Edge Function, nunca en el navegador. Prueba que un operador no pueda activar documentos, modificar referencias ni confirmar revisiones. Revisa también las políticas del bucket de Storage y crea respaldos antes de importar documentos reales.
