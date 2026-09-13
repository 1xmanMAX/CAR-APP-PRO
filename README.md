# SUNATAPP

App para empresa de transporte: guía de remisión transportista, factura del flete y cobros, conectada a SUNAT.

## Requisitos
Node 24+, pnpm 9.

## Uso local
```bash
pnpm install
cp .env.example .env      # SUNAT_MODO=simulado por defecto
pnpm test                 # todas las pruebas
pnpm demo                 # flujo completo: guía → factura → cobro (archivos en storage/)
```

## Modos SUNAT
- `simulado`: nada sale a internet; PDFs marcados "DOCUMENTO SIMULADO".
- `beta`: guías simuladas; facturas al ambiente beta oficial de SUNAT.
- `real`: requiere certificado `.pfx`, usuario SOL secundario y credenciales API SUNAT (ver spec, sección 13).

## Documentación
- Diseño: `docs/superpowers/specs/2026-09-13-mvp-gre-transportista-design.md`
- Planes: `docs/superpowers/plans/`
