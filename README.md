# Cloud Function - Perfilamiento de datos en BigQuery

# 1. Descripción

Esta Cloud Function permite generar un reporte de **perfilamiento de datos** en formato **HTML** a partir de una tabla de **BigQuery**.

La función recibe una solicitud HTTP con el identificador de la tabla y, opcionalmente, filtros por fecha y límite de registros. Luego consulta los datos, genera el análisis con **ydata-profiling** y guarda el resultado en un bucket de **Google Cloud Storage (GCS)**.

# 2. Objetivo

Facilitar el análisis exploratorio de tablas de BigQuery mediante la generación automática de reportes de profiling, permitiendo revisar:

- tipos de datos
- cantidad de registros
- valores nulos
- distribuciones
- duplicados
- estadísticas descriptivas
- calidad general de la información

# 3. Tecnologías utilizadas

- Python
- Google Cloud Functions
- Google BigQuery
- Google Cloud Storage
- Pandas
- ydata-profiling

# 4. Dependencias

## requirements.txt

```txt
functions-framework==3.*
google-cloud-bigquery==3.*
google-cloud-storage==2.*
pandas==2.*
pyarrow==15.*
db-dtypes==1.*
ydata-profiling==4.*
openpyxl==3.*
```

# 5. Uso de la Cloud Function

La Cloud Function recibe un request en formato JSON mediante una invocación HTTP `POST`.

## Parámetros de entrada

| Campo | Tipo | Obligatorio | Descripción |
|------|------|-------------|-------------|
| `full_table_id` | string | Sí | Nombre de la tabla en formato `dataset.tabla` |
| `periodo_desde` | string | No | Fecha inicial de consulta |
| `periodo_hasta` | string | No | Fecha final de consulta |
| `limit` | integer | No | Cantidad máxima de registros a consultar |

> **Importante:** el campo `limit` es opcional en todos los casos. Si no deseas limitar la cantidad de registros, simplemente puedes omitirlo del request.

# 6. Formatos de request soportados

La función permite cuatro formas de uso, dependiendo del tipo de consulta que se necesite realizar.

## 6.1 Formato normal

Se utiliza cuando se desea perfilar una tabla sin aplicar filtros por fecha.

```json
{
  "full_table_id": "gld_financiero.material_terminado_semielaborado",
  "limit": 1000
}
```

## 6.2 Formato desde

Se utiliza cuando se desea consultar información desde una fecha específica en adelante.

```json
{
  "full_table_id": "gld_financiero.venta_real",
  "periodo_desde": "2026-01-01",
  "limit": 1000
}
```

## 6.3 Formato hasta

Se utiliza cuando se desea consultar información hasta una fecha específica.

```json
{
  "full_table_id": "gld_financiero.venta_real",
  "periodo_hasta": "2026-03-05",
  "limit": 1000
}
```

## 6.4 Formato rango de fecha

Se utiliza cuando se desea consultar información comprendida entre una fecha inicial y una fecha final.

```json
{
  "full_table_id": "gld_financiero.venta_real",
  "periodo_desde": "2026-01-01",
  "periodo_hasta": "2026-03-01",
  "limit": 10000
}
```

# 7. Resumen de uso

| Formato | Cuándo usarlo |
|--------|---------------|
| Normal | Cuando no se necesita filtro por fechas |
| Desde | Cuando se desea consultar desde una fecha en adelante |
| Hasta | Cuando se desea consultar hasta una fecha específica |
| Rango de fecha | Cuando se desea consultar entre una fecha inicial y una fecha final |

# 8. Consideraciones importantes

- `full_table_id` es obligatorio en todos los casos.
- El formato esperado para `full_table_id` es `dataset.tabla`.
- `periodo_desde` y `periodo_hasta` son opcionales.
- `limit` también es opcional.
- En un JSON real no deben colocarse comentarios.
- Si no se envía `limit`, la consulta se ejecutará sin ese parámetro, según la lógica definida en la función.

# 9. Ejemplo general de invocación

## Request

```json
{
  "full_table_id": "gld_financiero.venta_real",
  "periodo_desde": "2026-01-01",
  "periodo_hasta": "2026-03-01",
  "limit": 5000
}
```

## Resultado esperado

- Se consulta la tabla indicada en BigQuery.
- Se aplican los filtros enviados en el request, si existen.
- Se genera un reporte HTML con el perfilamiento de datos.
- El archivo generado se almacena en un bucket de Google Cloud Storage.

# 10. Notas

- Se recomienda usar `limit` cuando la tabla tenga un volumen alto de registros.
- Si la tabla no requiere filtros de fecha, basta con enviar únicamente `full_table_id`.
- El reporte generado permite una revisión rápida de la calidad y comportamiento de los datos.
