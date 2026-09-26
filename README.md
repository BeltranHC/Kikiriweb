<div align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=40&pause=1000&color=F7F7F7&center=true&vCenter=true&width=600&height=80&lines=KikiriWeb;Sistema+de+Gesti%C3%B3n+Estudiantil" alt="Typing SVG" />
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
</p>

## Descripción

**KikiriWeb** es un sistema integral para la gestión de estudiantes y entrega de tickets, diseñado para ser rápido, moderno y eficiente. Permite el control de tickets (pagados/no pagados, extras, métodos de pago) y la administración de estudiantes mediante un dashboard intuitivo.

## Características Principales

- **Gestión de Estudiantes:** Agrega, edita y administra estudiantes.
- **Control de Tickets:** Registro detallado de entrega de tickets.
- **Estados de Ticket:** Marca tickets como pagados, especifica método de pago y diferencia tickets extras.
- **Dashboard Interactivo:** Vista general en tiempo real del estado de los tickets y estudiantes.
- **Base de Datos en Tiempo Real:** Desarrollado con Supabase para un rendimiento robusto.

## Tecnologías

- **Frontend:** [Next.js 14](https://nextjs.org/) (App Router), React
- **Backend & Auth:** [Supabase](https://supabase.com/) (PostgreSQL)

## Instalación y Configuración

Sigue estos pasos para correr el proyecto localmente:

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/tu-usuario/kikiriweb.git
   cd kikiriweb
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   # o
   yarn install
   # o
   pnpm install
   ```

3. **Configurar las variables de entorno:**
   Crea un archivo `.env.local` en la raíz del proyecto y agrega tus credenciales de Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
   ```

4. **Base de datos:**
   Ejecuta el archivo `database.sql` en el SQL Editor de tu proyecto de Supabase para generar las tablas y esquemas necesarios.

5. **Iniciar el servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Contribuir

¡Las contribuciones son bienvenidas! Si deseas mejorar este proyecto, por favor haz un _fork_ y envía un _Pull Request_.

## Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

---
<div align="center">
  <sub>Desarrollado para la gestión de tickets y estudiantes</sub>
</div>
