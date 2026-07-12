# EdificARTE

EdificARTE es una aplicación web interactiva de gamificación turística y audioguías geolocalizadas para monumentos históricos, enfocada inicialmente en la Ciudad de México (CDMX).

Este repositorio contiene la estructura base y el scaffolding inicial correspondientes al **Slice 1** del proyecto.

---

## Stack Tecnológico Confirmado

- **Framework**: [Astro](https://astro.build/) (versión 5.x) configurado en modo `output: "server"` para Server-Side Rendering (SSR) continuo.
- **Entorno Edge**: [Cloudflare Pages & Workers](https://workers.cloudflare.com/) con el adaptador oficial `@astrojs/cloudflare`.
- **Estilos**: [Tailwind CSS](https://tailwindcss.com/) (versión 3.x) con soporte nativo de Dark Mode por clase y media query.
- **Tipado**: [TypeScript](https://www.typescriptlang.org/) configurado en modo estricto (`strict: true`).
- **Persistencia y Almacenamiento (Preparados)**:
  - **D1 Database**: SQLite edge database de Cloudflare para datos de lugares e itinerarios.
  - **R2 Bucket**: Storage S3-compatible para archivos de audio.
  - **KV Namespace**: Almacén clave-valor para caches de alto rendimiento.
- **Gestor de Paquetes**: `pnpm`.

---

## Contratos Inteligentes (Polygon Mainnet)

La aplicación interactúa con contratos inteligentes desplegados en la red de Polygon (chainId: 137). Puedes verificar las transacciones y el código fuente en PolygonScan:

- **Badge Contract (Insignias / POAPs)**: [`0xF3BFe6Fac28Fa7E17280fd74e9C52294686a5F25`](https://polygonscan.com/address/0xF3BFe6Fac28Fa7E17280fd74e9C52294686a5F25)
- **Review Contract (Reseñas On-Chain)**: [`0x993362db73F57f3CbEBD310b31E42Bb21ED27538`](https://polygonscan.com/address/0x993362db73F57f3CbEBD310b31E42Bb21ED27538)
- **USDC Contract (Token Nativo Polygon)**: [`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`](https://polygonscan.com/address/0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)

---

## Comenzando (Quickstart)

Para levantar el entorno de desarrollo local, seguí estos pasos:

### 1. Clonar el repositorio e instalar dependencias

Asegurate de contar con Node.js en su versión LTS actual (indicada en el archivo `.nvmrc`) y `pnpm` instalado:

```bash
pnpm install
```

### 2. Ejecutar el servidor de desarrollo local

Iniciá el servidor de desarrollo de Astro en el puerto por defecto:

```bash
pnpm dev
```

El servidor estará escuchando en `http://localhost:4321`.

### 3. Generar tipos para bindings de Cloudflare

Para que TypeScript reconozca los bindings declarados de Cloudflare, ejecutá:

```bash
pnpm wrangler:types
```

Esto generará el archivo `worker-configuration.d.ts` con las interfaces de tipo para los recursos declarados en `wrangler.jsonc`.

---

## Scripts Disponibles

En el proyecto podés ejecutar los siguientes scripts:

- `pnpm dev` / `pnpm start`: Levanta el dev server local de Astro (`localhost:4321`).
- `pnpm build`: Compila la aplicación generando el bundle optimizado para Cloudflare en el directorio `dist/`.
- `pnpm preview`: Levanta una simulación local del build compilado en la carpeta `dist/` usando Wrangler.
- `pnpm lint`: Ejecuta el análisis estático de ESLint y la verificación de estilo de Prettier en todo el proyecto.
- `pnpm format`: Formatea de manera automática todos los archivos usando Prettier.
- `pnpm typecheck`: Ejecuta `astro check` y el compilador de TypeScript (`tsc --noEmit`) para validar que no haya errores de tipo.
- `pnpm wrangler:types`: Invoca a Wrangler para generar la definición de tipos de los recursos (`Env`).

---

## Decisiones Clave y Configuración

1. **Output Mode `server`**: Astro está configurado para correr SSR en cada petición. Esto es necesario para poder acceder a los bindings de Cloudflare (D1, KV, R2) en tiempo de ejecución en cualquiera de las rutas.
2. **Wrangler JSONC**: Se utiliza el formato moderno `wrangler.jsonc` (que admite comentarios y una estructura JSON estricta) para configurar los entornos y declarar los bindings con Cloudflare.
3. **Bindings de Cloudflare**:
   - `DB`: Enlace a la base de datos D1.
   - `ASSETS`: Enlace al bucket R2 para recursos multimedia (audios).
   - `CACHE`: Enlace al namespace KV de cache.
     _Nota: Los IDs de los recursos en `wrangler.jsonc` se configuran inicialmente como placeholders. Deberán reemplazarse por las credenciales de un dashboard real de Cloudflare antes del primer despliegue en producción._

---

## Estado del Testing (Deuda Técnica de TDD)

> [!IMPORTANT]
> **MODO DE DESARROLLO ACTUAL: Standard Mode (Sin infraestructura de testing)**
>
> En este Slice 1, por decisión de diseño y alcance, **se omitió la instalación de Vitest** y de `@cloudflare/vitest-pool-workers` (Opción A aprobada).
>
> **Consecuencia**: El repositorio no posee pruebas unitarias ni de integración. Para restablecer el modo estricto de desarrollo guiado por pruebas (Strict TDD Mode) definido globalmente en las convenciones del equipo, el **primer Pull Request que introduzca lógica de negocio o de datos (en el Slice 2+) tendrá la obligación de configurar la infraestructura de pruebas** antes de que cualquier nueva lógica pueda considerarse completada.
