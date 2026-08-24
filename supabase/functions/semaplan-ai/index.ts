import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Construir_Obra_Compacta_Decoteca,
  Seleccionar_Pagina_Decoteca,
} from "./decoteca_paginacion.mjs";

type Mapa = Record<string, unknown>;

const Cors_Headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, " +
    "content-type, x-semaplan-ai-token",
  "Access-Control-Allow-Methods":
    "GET, POST, OPTIONS",
};

type Auth_Resultado =
  | {
    Ok: true;
    Usuario_Id: string;
    Fuente: "jwt" | "token" | "oauth";
    Scopes: string[];
  }
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

type Estado_Resultado =
  | {
    Ok: true;
    Estado: Record<string, unknown>;
    Version: number;
    Actualizado_En: string | null;
  }
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

const Claves_Estado_Seguras = new Set([
  "Objetivos",
  "Eventos",
  "Slots_Muertos",
  "Planes_Slot",
  "Planes_Semana",
  "Planes_Periodo",
  "Plantillas_Subobjetivos",
  "Tareas",
  "Tareas_Cajones_Definidos",
  "Habitos",
  "Habitos_Registros",
  "Baul_Objetivos",
  "Archiveros",
  "Notas_Archivero",
  "Etiquetas_Archivero",
  "Patrones",
  "Categorias",
  "Etiquetas",
  "Tipos_Slot",
  "Tipos_Slot_Inicializados",
  "Slots_Muertos_Tipos",
  "Slots_Muertos_Nombres",
  "Slots_Muertos_Titulos_Visibles",
  "Slots_Muertos_Nombres_Auto",
  "Slots_Muertos_Grupo_Ids",
  "Config_Extra",
  "Inicio_Semana",
  "Contador_Eventos",
  "Semanas_Con_Defaults",
  "Esquema_Estado_Version",
  "Version_Programa_Actual",
  "Decoteca",
]);

const OAUTH_SCOPE_LECTURA = "read";
const OAUTH_SCOPE_TAREAS = "write_tasks";
const OAUTH_SCOPE_HABITOS = "write_habits";
const OAUTH_SCOPE_METAS = "write_metas";
const OAUTH_SCOPE_ARCHIVERO = "write_archivero";
const OAUTH_SCOPE_BAUL = "write_baul";
const OAUTH_SCOPE_DECOTECA = "write_decoteca";
const OAUTH_SCOPES_SOPORTADOS = new Set([
  OAUTH_SCOPE_LECTURA,
  OAUTH_SCOPE_TAREAS,
  OAUTH_SCOPE_HABITOS,
  OAUTH_SCOPE_METAS,
  OAUTH_SCOPE_ARCHIVERO,
  OAUTH_SCOPE_BAUL,
  OAUTH_SCOPE_DECOTECA,
]);
const OAUTH_RESPONSE_TYPE_CODIGO = "code";
const OAUTH_AUTH_CODE_EXPIRA_SEGUNDOS = 300;
const OAUTH_ACCESS_TOKEN_EXPIRA_SEGUNDOS =
  60 * 60 * 24 * 30;

function Obtener_Config_OAuth() {
  const Cliente_Id = String(
    Deno.env.get("SEMAPLAN_AI_OAUTH_CLIENT_ID") ||
      "semaplan-chatgpt"
  ).trim();
  const Cliente_Secret = String(
    Deno.env.get("SEMAPLAN_AI_OAUTH_CLIENT_SECRET") ||
      ""
  ).trim();
  const Habilitado =
    Boolean(Cliente_Id) && Boolean(Cliente_Secret);
  return {
    Habilitado,
    Cliente_Id,
    Cliente_Secret,
  };
}

function Es_Redirect_ChatGPT_Valido(
  Redirect_Uri: string
) {
  try {
    const Url = new URL(Redirect_Uri);
    const Host = Url.hostname.toLowerCase();
    if (
      Host !== "chat.openai.com" &&
      Host !== "chatgpt.com"
    ) {
      return false;
    }
    return /^\/aip\/[^/]+\/oauth\/callback$/.test(
      Url.pathname
    );
  } catch (_) {
    return false;
  }
}

function Responder_Json(
  Cuerpo: Record<string, unknown>,
  Status = 200
) {
  return new Response(JSON.stringify(Cuerpo), {
    status: Status,
    headers: {
      ...Cors_Headers,
      "Content-Type": "application/json",
    },
  });
}

function Responder_Error(
  Status: number,
  Error: string,
  Detalle: string
) {
  return Responder_Json(
    {
      Ok: false,
      Error,
      Detalle,
    },
    Status
  );
}

function Responder_OAuth_Error(
  Status: number,
  Error: string,
  Descripcion: string
) {
  return Responder_Json(
    {
      error: Error,
      error_description: Descripcion,
    },
    Status
  );
}

function Obtener_Ruta_Relativa(Req: Request) {
  const Url = new URL(Req.url);
  const Segmentos = Url.pathname
    .split("/")
    .filter(Boolean);
  const Indice = Segmentos.lastIndexOf(
    "semaplan-ai"
  );
  if (Indice >= 0) {
    const Resto = Segmentos.slice(Indice + 1);
    return `/${Resto.join("/")}`.replace(
      /\/+$/,
      ""
    ) || "/";
  }
  return Url.pathname.replace(/\/+$/, "") || "/";
}

function Obtener_Url_Base_Gateway(
  Req: Request
) {
  const Base_Configurada = Normalizar_Texto(
    Deno.env.get("SEMAPLAN_AI_PUBLIC_BASE_URL")
  );
  if (Base_Configurada) {
    return Base_Configurada.replace(/\/+$/, "");
  }

  const Supabase_Url = Normalizar_Texto(
    Deno.env.get("SUPABASE_URL")
  ).replace(/\/+$/, "");
  if (Supabase_Url && /\.supabase\.co$/i.test(Supabase_Url)) {
    return `${Supabase_Url}/functions/v1/semaplan-ai`;
  }

  const Url = new URL(Req.url);
  const Segmentos = Url.pathname
    .split("/")
    .filter(Boolean);
  const Indice = Segmentos.lastIndexOf(
    "semaplan-ai"
  );
  if (Indice >= 0) {
    return `${Url.origin}/${Segmentos
      .slice(0, Indice + 1)
      .join("/")}`;
  }
  return Url.origin;
}

function Construir_OpenAPI_Semaplan_IA(
  Base_Url: string,
  Modo_Auth: "oauth" | "api_key" = "oauth",
  Incluir_Rutas_Internas = true
) {
  const Respuesta_200 = {
    description: "Respuesta exitosa.",
    content: {
      "application/json": {
        schema: {
          $ref:
            "#/components/schemas/SemaplanRespuestaExitosa",
        },
      },
    },
  };
  const Respuesta_Error = {
    description:
      "Error estandar del gateway.",
    content: {
      "application/json": {
        schema: {
          $ref:
            "#/components/schemas/SemaplanRespuestaError",
        },
      },
    },
  };
  const Es_Api_Key = Modo_Auth === "api_key";
  const Nombre_Seguridad = Es_Api_Key
    ? "SemaplanAIToken"
    : "SemaplanAIOAuth";
  const Seguridad_Lectura = [
    {
      [Nombre_Seguridad]: Es_Api_Key
        ? []
        : [OAUTH_SCOPE_LECTURA],
    },
  ];
  const Seguridad_Escritura = (Scope: string) => [
    {
      [Nombre_Seguridad]: Es_Api_Key
        ? []
        : [
          OAUTH_SCOPE_LECTURA,
          Scope,
        ],
    },
  ];
  const Respuestas_B2 = {
    "200": Respuesta_200,
    "400": Respuesta_Error,
    "401": Respuesta_Error,
    "403": Respuesta_Error,
    "405": Respuesta_Error,
    "409": Respuesta_Error,
  };
  const Body_B2 = (Schema: Mapa) => ({
    required: true,
    content: {
      "application/json": {
        schema: Schema,
      },
    },
  });
  const Post_B2 = (
    Operation_Id: string,
    Summary: string,
    Scope: string,
    Schema: Mapa
  ) => ({
    post: {
      operationId: Operation_Id,
      summary: Summary,
      security: Seguridad_Escritura(Scope),
      requestBody: Body_B2(Schema),
      responses: Respuestas_B2,
    },
  });
  const Schema_Base_B2 = {
    type: "object",
    properties: {
      idempotency_key: {
        type: "string",
        description:
          "Clave opcional para evitar repetir la misma mutacion.",
      },
    },
    additionalProperties: true,
  };

  const Contrato = {
    openapi: "3.1.0",
    info: {
      title: "Semaplan AI Gateway",
      version: "2.3.0",
      description:
        "API para leer Semaplan y ejecutar acciones B2 desde ChatGPT.",
    },
    servers: [
      {
        url: Base_Url,
      },
    ],
    components: {
      schemas: {
        SemaplanRespuestaExitosa: {
          type: "object",
          properties: {
            Ok: {
              type: "boolean",
              example: true,
            },
          },
          required: ["Ok"],
          additionalProperties: true,
        },
        SemaplanRespuestaError: {
          type: "object",
          properties: {
            Ok: {
              type: "boolean",
              example: false,
            },
            Error: {
              type: "string",
            },
            Detalle: {
              type: "string",
            },
          },
          required: [
            "Ok",
            "Error",
            "Detalle",
          ],
          additionalProperties: true,
        },
        SemaplanRespuestaBusqueda: {
          type: "object",
          properties: {
            Ok: { type: "boolean", example: true },
            Query: { type: "string" },
            Modulo: { type: "string" },
            Total: { type: "integer", minimum: 0 },
            Offset: { type: "integer", minimum: 0 },
            Limite: { type: "integer", minimum: 1 },
            Hay_Mas: { type: "boolean" },
            Siguiente_Offset: {
              type: ["integer", "null"],
              minimum: 0,
            },
            Filtros: { type: "object" },
            Compacto: { type: "boolean" },
            Resultados: {
              type: "array",
              items: { type: "object" },
            },
          },
          required: [
            "Ok",
            "Total",
            "Offset",
            "Limite",
            "Hay_Mas",
            "Siguiente_Offset",
            "Resultados",
          ],
          additionalProperties: true,
        },
      },
      securitySchemes: Es_Api_Key
        ? {
          SemaplanAIToken: {
            type: "apiKey",
            in: "header",
            name: "X-Semaplan-AI-Token",
            description:
              "Token personal de Semaplan AI con scopes B2.",
          },
        }
        : {
          SemaplanAIOAuth: {
            type: "oauth2",
            flows: {
              authorizationCode: {
                authorizationUrl:
                  `${Base_Url}/oauth/authorize`,
                tokenUrl: `${Base_Url}/oauth/token`,
                scopes: {
                  [OAUTH_SCOPE_LECTURA]:
                    "Lectura de datos del usuario en Semaplan.",
                  [OAUTH_SCOPE_TAREAS]:
                    "Crear, marcar y reprogramar tareas.",
                  [OAUTH_SCOPE_HABITOS]:
                    "Crear habitos y registrar cumplimiento.",
                  [OAUTH_SCOPE_METAS]:
                    "Operar el arbol de Planes por periodos y sus avances.",
                  [OAUTH_SCOPE_ARCHIVERO]:
                    "Crear notas en el Archivero.",
                  [OAUTH_SCOPE_BAUL]:
                    "Crear items en el Baul.",
                  [OAUTH_SCOPE_DECOTECA]:
                    "Crear, editar y borrar obras y tecas de Decoteca.",
                },
              },
            },
          },
        },
    },
    paths: {
      "/salud": {
        get: {
          operationId: "semaplan_salud",
          summary:
            "Chequear salud del gateway",
          responses: {
            "200": Respuesta_200,
          },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "semaplan_openapi",
          summary:
            "Obtener contrato OpenAPI del gateway",
          responses: {
            "200": Respuesta_200,
          },
        },
      },
      "/contexto": {
        get: {
          operationId: "semaplan_contexto",
          summary:
            "Obtener contexto compacto de Semaplan",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "desde",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "hasta",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/agenda": {
        get: {
          operationId: "semaplan_agenda",
          summary:
            "Leer agenda, eventos y slots muertos por rango",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "desde",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "hasta",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/tareas": {
        get: {
          operationId: "semaplan_tareas",
          summary: "Leer tareas por rango y filtros",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "desde",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "hasta",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "cajon",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "estado",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/habitos": {
        get: {
          operationId: "semaplan_habitos",
          summary: "Leer habitos visibles",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "fecha",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "modo",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "Dia",
                  "Semana",
                  "Quincena",
                  "Mes",
                  "Todos",
                ],
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/slots": {
        get: {
          operationId: "semaplan_slots",
          summary:
            "Leer slots vacios o muertos por rango",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "desde",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
            {
              name: "hasta",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/planes/semana": {
        get: {
          operationId: "semaplan_plan_semana",
          summary:
            "Leer snapshot y diff del plan semanal",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "semana",
              in: "query",
              schema: {
                type: "string",
                format: "date",
              },
              description:
                "Fecha dentro de la semana deseada. El gateway la resuelve al lunes correspondiente.",
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/planes/periodos": {
        get: {
          operationId:
            "semaplan_planes_periodos",
          summary:
            "Leer periodos o el arbol completo de Planes de un periodo",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "periodo_id",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "tipo",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "Anio",
                  "Semestre",
                  "Trimestre",
                  "Mes",
                ],
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
            {
              name: "incluir_eliminados",
              in: "query",
              schema: { type: "boolean" },
              description:
                "Incluye elementos archivados logicamente. Por defecto se omiten.",
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
            "404": Respuesta_Error,
          },
        },
      },
      "/archivero": {
        get: {
          operationId:
            "semaplan_listar_archivero",
          summary:
            "Listar cajones y notas del Archivero",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "cajon_id",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
            "404": Respuesta_Error,
          },
        },
      },
      "/archivero/buscar": {
        get: {
          operationId:
            "semaplan_buscar_archivero",
          summary:
            "Buscar notas del Archivero por texto",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: {
                type: "string",
                maxLength: 200,
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 50,
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/baul": {
        get: {
          operationId: "semaplan_listar_baul",
          summary:
            "Listar objetivos del Baul",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "categoria",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "estado",
              in: "query",
              schema: {
                type: "string",
              },
            },
            {
              name: "limite",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/buscar": {
        get: {
          operationId: "semaplan_buscar_global",
          summary: "Buscar en tareas, habitos, Planes, Archivero, Baul y Decoteca",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "q",
              in: "query",
              description:
                "Texto a buscar. Puede omitirse solo con modulo=decoteca para listar una teca.",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "modulo",
              in: "query",
              description:
                "Usa decoteca para limitar la busqueda o listar una teca completa.",
              schema: {
                type: "string",
                enum: ["todos", "decoteca"],
                default: "todos",
              },
            },
            {
              name: "teca_id",
              in: "query",
              description:
                "Teca de Decoteca: Biblioteca, Musicoteca, Videoteca, Ludoteca o un id personalizado.",
              schema: { type: "string" },
            },
            {
              name: "limite",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
            {
              name: "offset",
              in: "query",
              description:
                "Cantidad de resultados que se deben saltar. Por defecto 0. Para Decoteca se aplica despues de los filtros y del orden estable.",
              schema: {
                type: "integer",
                minimum: 0,
                default: 0,
              },
            },
            {
              name: "filtros",
              in: "query",
              style: "deepObject",
              explode: true,
              description:
                "Filtros explicitos de Decoteca. Se combinan con AND.",
              schema: {
                type: "object",
                properties: {
                  descripcion_vacia: { type: "boolean" },
                  creador_vacio: { type: "boolean" },
                  anio_vacio: { type: "boolean" },
                  genero_vacio: { type: "boolean" },
                  subgenero_vacio: { type: "boolean" },
                  portada_vacia: { type: "boolean" },
                  total_unidades_cero: { type: "boolean" },
                  estado: { type: "string" },
                  periodo: { type: "string" },
                  prioridad: { type: "string" },
                },
                additionalProperties: false,
              },
            },
            {
              name: "compacto",
              in: "query",
              description:
                "En Decoteca omite registros, partes, metadatos e imagenes codificadas. Por defecto false para compatibilidad.",
              schema: {
                type: "boolean",
                default: false,
              },
            },
          ],
          responses: {
            "200": {
              description: "Respuesta de busqueda y paginacion.",
              content: {
                "application/json": {
                  schema: {
                    $ref:
                      "#/components/schemas/SemaplanRespuestaBusqueda",
                  },
                },
              },
            },
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/resumen": {
        get: {
          operationId: "semaplan_resumen_operativo",
          summary: "Resumir prioridades, agenda, tareas, habitos y Planes",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "periodo",
              in: "query",
              schema: {
                type: "string",
                enum: ["dia", "semana"],
                default: "dia",
              },
            },
            {
              name: "fecha",
              in: "query",
              schema: { type: "string", format: "date" },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/diagnostico/planes": {
        get: {
          operationId: "semaplan_diagnosticar_planes",
          summary: "Detectar desvios, vencimientos y ramas incompletas de Planes",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "periodo_id",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "fecha",
              in: "query",
              schema: { type: "string", format: "date" },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "400": Respuesta_Error,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
            "404": Respuesta_Error,
          },
        },
      },
      "/historial": {
        get: {
          operationId: "semaplan_historial_chat",
          summary: "Leer cambios realizados por el chat y sus versiones",
          security: Seguridad_Lectura,
          parameters: [
            {
              name: "limite",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50 },
            },
          ],
          responses: {
            "200": Respuesta_200,
            "401": Respuesta_Error,
            "403": Respuesta_Error,
          },
        },
      },
      "/b2/lote": Post_B2(
        "semaplan_b2_lote_operaciones",
        "Previsualizar y aplicar hasta 50 acciones combinadas de Semaplan",
        OAUTH_SCOPE_LECTURA,
        {
          ...Schema_Base_B2,
          required: ["operaciones"],
          properties: {
            ...Schema_Base_B2.properties,
            operaciones: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              description:
                "Acciones combinadas y atomicas sobre tareas, habitos, Planes, Archivero, Baul y Decoteca. Cada elemento usa accion y payload con los mismos campos de su accion individual.",
              items: {
                type: "object",
                required: ["accion", "payload"],
                properties: {
                  accion: {
                    type: "string",
                    enum: [
                      "crear_tarea",
                      "marcar_tarea",
                      "reprogramar_tarea",
                      "editar_tarea",
                      "borrar_tarea",
                      "duplicar_tarea",
                      "crear_habito",
                      "registrar_habito",
                      "mutar_objetivo_plan",
                      "mutar_subobjetivo_plan",
                      "mutar_parte_plan",
                      "mutar_avance_plan",
                      "crear_nota_archivero",
                      "crear_item_baul",
                      "crear_obra_decoteca",
                      "editar_obra_decoteca",
                      "borrar_obra_decoteca",
                      "crear_teca_decoteca",
                      "editar_teca_decoteca",
                      "borrar_teca_decoteca",
                    ],
                  },
                  payload: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            },
            confirmar_aplicacion: { type: "boolean", default: false },
          },
        },
      ),
      "/b2/deshacer": Post_B2(
        "semaplan_b2_deshacer",
        "Deshacer la ultima mutacion del chat o una mutacion indicada",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            mutacion_id: { type: "string" },
            confirmar_deshacer: { type: "boolean", default: false },
          },
        },
      ),
      "/openapi-key.json": {
        get: {
          operationId: "semaplan_openapi_key",
          summary:
            "Obtener contrato OpenAPI con API key por header",
          responses: {
            "200": Respuesta_200,
          },
        },
      },
      "/b2/tareas/crear": Post_B2(
        "semaplan_b2_crear_tarea",
        "Crear una tarea en Semaplan",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          required: ["nombre"],
          properties: {
            ...Schema_Base_B2.properties,
            nombre: { type: "string" },
            fecha: { type: "string", format: "date" },
            fecha_relativa: {
              type: "string",
              description: "hoy, manana, pasado manana, proximo lunes o en N dias.",
            },
            hora: {
              type: "string",
              pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$",
            },
            cajon: { type: "string" },
            prioridad: { type: "string" },
            emoji: { type: "string" },
            descripcion: { type: "string" },
            etiquetas: { type: "array", items: { type: "string" } },
            fecha_limite: { type: "string", format: "date" },
            repeticion: { type: "object" },
            subtareas: { type: "array", items: { type: "object" } },
            adjuntos: { type: "array", items: { type: "string" } },
            dependencias_ids: { type: "array", items: { type: "string" } },
            estimacion_minutos: { type: "number", minimum: 0 },
          },
        },
      ),
      "/b2/tareas/marcar": Post_B2(
        "semaplan_b2_marcar_tarea",
        "Marcar una tarea como hecha o pendiente",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            tarea_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            hecha: { type: "boolean", default: true },
          },
        },
      ),
      "/b2/tareas/reprogramar": Post_B2(
        "semaplan_b2_reprogramar_tarea",
        "Cambiar fecha y hora de una tarea, incluso si esta planificada",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            tarea_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            fecha: { type: "string", format: "date" },
            fecha_relativa: {
              type: "string",
              description: "hoy, manana, pasado manana, proximo lunes o en N dias.",
            },
            hora: {
              type: "string",
              pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$",
            },
            sin_horario: { type: "boolean" },
          },
        },
      ),
      "/b2/tareas/editar": Post_B2(
        "semaplan_b2_editar_tarea",
        "Editar cualquier tarea sin cambiar su estado salvo pedido expreso",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            tarea_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            nuevo_nombre: { type: "string" },
            emoji: { type: "string" },
            cajon: { type: "string" },
            prioridad: { type: "string" },
            descripcion: { type: "string" },
            etiquetas: { type: "array", items: { type: "string" } },
            fecha_limite: { type: "string", format: "date" },
            repeticion: { type: "object" },
            subtareas: { type: "array", items: { type: "object" } },
            adjuntos: { type: "array", items: { type: "string" } },
            dependencias_ids: { type: "array", items: { type: "string" } },
            estimacion_minutos: { type: "number", minimum: 0 },
            tiempo_registrado_minutos: { type: "number", minimum: 0 },
            motivo_posposicion: { type: "string" },
            fecha_sugerida: { type: "string", format: "date" },
            archivada: { type: "boolean" },
            estado: {
              type: "string",
              description:
                "Omitir para conservar el estado actual, incluso si la tarea esta completada.",
              enum: [
                "pendiente",
                "completada",
                "pospuesta",
                "cancelada",
              ],
            },
            fecha: { type: "string", format: "date" },
            fecha_relativa: {
              type: "string",
              description: "hoy, manana, pasado manana, proximo lunes o en N dias.",
            },
            hora: {
              type: "string",
              pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$",
            },
            sin_horario: { type: "boolean" },
          },
        },
      ),
      "/b2/tareas/borrar": Post_B2(
        "semaplan_b2_borrar_tarea",
        "Borrar una tarea y desvincularla de agenda o planes",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            tarea_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            confirmar_eliminacion: { type: "boolean" },
          },
        },
      ),
      "/b2/tareas/duplicar": Post_B2(
        "semaplan_b2_duplicar_tarea",
        "Duplicar una tarea conservando sus datos y dejando la copia pendiente",
        OAUTH_SCOPE_TAREAS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            tarea_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            nuevo_nombre: { type: "string" },
            fecha: { type: "string", format: "date" },
          },
        },
      ),
      "/b2/habitos/crear": Post_B2(
        "semaplan_b2_crear_habito",
        "Crear un habito simple",
        OAUTH_SCOPE_HABITOS,
        {
          ...Schema_Base_B2,
          required: ["nombre"],
          properties: {
            ...Schema_Base_B2.properties,
            nombre: { type: "string" },
            tipo: { type: "string", enum: ["Hacer", "Evitar"] },
            cantidad: { type: "number" },
            unidad: { type: "string" },
            emoji: { type: "string" },
            color: { type: "string" },
          },
        },
      ),
      "/b2/habitos/registrar": Post_B2(
        "semaplan_b2_registrar_habito",
        "Registrar cumplimiento de un habito",
        OAUTH_SCOPE_HABITOS,
        {
          ...Schema_Base_B2,
          properties: {
            ...Schema_Base_B2.properties,
            habito_id: { type: "string" },
            busqueda: { type: "string" },
            nombre: { type: "string" },
            fecha: { type: "string", format: "date" },
            cantidad: { type: "number" },
            nota: { type: "string" },
          },
        },
      ),
      "/b2/planes/objetivos": Post_B2(
        "semaplan_b2_mutar_objetivo_plan",
        "Crear, editar o borrar un objetivo de Planes por periodo",
        OAUTH_SCOPE_METAS,
        {
          ...Schema_Base_B2,
          required: ["operacion"],
          properties: {
            ...Schema_Base_B2.properties,
            operacion: {
              type: "string",
              enum: ["crear", "editar", "borrar"],
            },
            objetivo_id: { type: "string" },
            periodo_id: { type: "string" },
            objetivo_padre_id: { type: "string" },
            nombre: { type: "string" },
            descripcion: { type: "string" },
            emoji: { type: "string" },
            color: { type: "string" },
            target_total: { type: "number", minimum: 0 },
            unidad: { type: "string" },
            unidad_custom: { type: "string" },
            modo_progreso: {
              type: "string",
              enum: ["Manual", "Leido", "Hibrido"],
            },
            etiquetas_ids: {
              type: "array",
              items: { type: "string" },
            },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            metadatos_campos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  nombre: { type: "string" },
                  tipo: {
                    type: "string",
                    enum: ["String", "Numerico"],
                  },
                },
                required: ["nombre"],
              },
            },
            confirmar_eliminacion: { type: "boolean" },
            alcance_eliminacion: {
              type: "string",
              enum: ["solo", "hijos", "todos"],
            },
          },
        },
      ),
      "/b2/planes/subobjetivos": Post_B2(
        "semaplan_b2_mutar_subobjetivo_plan",
        "Crear, editar o borrar un subobjetivo de Planes",
        OAUTH_SCOPE_METAS,
        {
          ...Schema_Base_B2,
          required: ["operacion"],
          properties: {
            ...Schema_Base_B2.properties,
            operacion: {
              type: "string",
              enum: ["crear", "editar", "borrar"],
            },
            subobjetivo_id: { type: "string" },
            objetivo_id: { type: "string" },
            subobjetivo_padre_id: { type: "string" },
            texto: { type: "string" },
            emoji: { type: "string" },
            target_total: { type: "number", minimum: 0 },
            aporte_meta: { type: "number", minimum: 0 },
            unidad: { type: "string" },
            unidad_custom: { type: "string" },
            fecha_inicio: { type: "string", format: "date" },
            fecha_objetivo: { type: "string", format: "date" },
            metadatos: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            confirmar_eliminacion: { type: "boolean" },
          },
        },
      ),
      "/b2/planes/partes": Post_B2(
        "semaplan_b2_mutar_parte_plan",
        "Crear, editar o borrar una parte de un subobjetivo",
        OAUTH_SCOPE_METAS,
        {
          ...Schema_Base_B2,
          required: ["operacion"],
          properties: {
            ...Schema_Base_B2.properties,
            operacion: {
              type: "string",
              enum: ["crear", "editar", "borrar"],
            },
            parte_id: { type: "string" },
            subobjetivo_id: { type: "string" },
            nombre: { type: "string" },
            emoji: { type: "string" },
            aporte_total: { type: "number", minimum: 0 },
            unidad: { type: "string" },
            unidad_custom: { type: "string" },
            fecha_inicio: { type: "string", format: "date" },
            fecha_objetivo: { type: "string", format: "date" },
            metadatos: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            confirmar_eliminacion: { type: "boolean" },
          },
        },
      ),
      "/b2/planes/avances": Post_B2(
        "semaplan_b2_mutar_avance_plan",
        "Crear, editar o borrar un registro manual de avance",
        OAUTH_SCOPE_METAS,
        {
          ...Schema_Base_B2,
          required: ["operacion"],
          properties: {
            ...Schema_Base_B2.properties,
            operacion: {
              type: "string",
              enum: ["crear", "editar", "borrar"],
            },
            avance_id: { type: "string" },
            objetivo_id: { type: "string" },
            subobjetivo_id: { type: "string" },
            parte_id: { type: "string" },
            cantidad: { type: "number", minimum: 0 },
            unidad: { type: "string" },
            fecha: { type: "string", format: "date" },
            hora: {
              type: "string",
              pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$",
            },
            nota: { type: "string" },
            metadatos: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            confirmar_eliminacion: { type: "boolean" },
          },
        },
      ),
      "/b2/archivero/nota": Post_B2(
        "semaplan_b2_crear_nota_archivero",
        "Crear una nota en el Archivero",
        OAUTH_SCOPE_ARCHIVERO,
        {
          ...Schema_Base_B2,
          required: ["texto"],
          properties: {
            ...Schema_Base_B2.properties,
            texto: { type: "string" },
            titulo: { type: "string" },
            cajon_id: { type: "string" },
            cajon: { type: "string" },
            etiquetas: {
              type: "array",
              items: { type: "string" },
            },
            origen: { type: "string" },
          },
        },
      ),
      "/b2/baul/item": Post_B2(
        "semaplan_b2_crear_item_baul",
        "Crear un item en el Baul",
        OAUTH_SCOPE_BAUL,
        {
          ...Schema_Base_B2,
          required: ["nombre"],
          properties: {
            ...Schema_Base_B2.properties,
            nombre: { type: "string" },
            descripcion: { type: "string" },
            estado: {
              type: "string",
              enum: ["activo", "pendiente", "pausado"],
            },
            categoria_id: { type: "string" },
            horas_aprox: { type: "number" },
            timeline: { type: "string", format: "date" },
            emoji: { type: "string" },
            color: { type: "string" },
          },
        },
      ),
    },
  };
  if (!Incluir_Rutas_Internas) {
    const Rutas = Contrato.paths as Record<string, unknown>;
    delete Rutas["/salud"];
    delete Rutas["/openapi.json"];
    delete Rutas["/openapi-key.json"];
  }
  return Contrato;
}

function Crear_Supabase_Servicio() {
  const Supabase_Url = Deno.env.get(
    "SUPABASE_URL"
  );
  const Service_Role_Key = Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  if (!Supabase_Url || !Service_Role_Key) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(
    Supabase_Url,
    Service_Role_Key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function Crear_Supabase_Usuario(Auth_Header: string) {
  const Supabase_Url = Deno.env.get(
    "SUPABASE_URL"
  );
  const Supabase_Anon_Key = Deno.env.get(
    "SUPABASE_ANON_KEY"
  );
  if (!Supabase_Url || !Supabase_Anon_Key) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_ANON_KEY."
    );
  }
  return createClient(
    Supabase_Url,
    Supabase_Anon_Key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: Auth_Header,
        },
      },
    }
  );
}

async function Hash_Token(Token: string) {
  const Buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(Token)
  );
  return Array.from(new Uint8Array(Buffer))
    .map((Byte) =>
      Byte.toString(16).padStart(2, "0")
    )
    .join("");
}

function Tiene_Scope_Lectura(
  Scopes: unknown
) {
  return Tiene_Scope(Scopes, OAUTH_SCOPE_LECTURA);
}

function Tiene_Scope(
  Scopes: unknown,
  Scope_Requerido: string
) {
  if (!Array.isArray(Scopes)) return false;
  const Tiene = (Scope_Buscado: string) => Scopes.some((Scope) =>
    String(Scope || "").trim() === Scope_Buscado
  );
  if (Scope_Requerido === OAUTH_SCOPE_DECOTECA) {
    // Compatibilidad con los tokens B2 ya emitidos antes de que
    // Decoteca tuviera un permiso independiente.
    return Tiene(OAUTH_SCOPE_DECOTECA) || Tiene(OAUTH_SCOPE_METAS);
  }
  return Tiene(Scope_Requerido);
}

function Tiene_Scopes_B2(
  Scopes: unknown,
  Scopes_Requeridos: unknown
) {
  const Requeridos = String(Scopes_Requeridos || "")
    .split(/\s+/)
    .map((Scope) => Scope.trim())
    .filter(Boolean);
  return Requeridos.length > 0 && Requeridos.every((Scope) =>
    Tiene_Scope(Scopes, Scope)
  );
}

function Normalizar_Scopes_OAuth(
  Scope_Raw: string
) {
  const Unicos = new Set(
    Scope_Raw
      .split(/\s+/)
      .map((Item) => Item.trim())
      .filter(Boolean)
  );
  if (Unicos.size === 0) {
    return [OAUTH_SCOPE_LECTURA];
  }
  return Array.from(Unicos);
}

function Hay_Scopes_OAuth_Desconocidos(
  Scopes: string[]
) {
  return Scopes.some((Scope) =>
    !OAUTH_SCOPES_SOPORTADOS.has(Scope)
  );
}

function Generar_Secreto_Token(
  Prefijo: string
) {
  const Bytes = new Uint8Array(24);
  crypto.getRandomValues(Bytes);
  const Base = Array.from(Bytes)
    .map((Byte) =>
      Byte.toString(16).padStart(2, "0")
    )
    .join("");
  return `${Prefijo}_${Base}`;
}

type Resultado_Validacion_Token_IA = {
  Encontrado: boolean;
  Resultado: Auth_Resultado | null;
};

async function Validar_Token_IA_Por_Valor(
  Token_IA: string,
  Fuente_Exito: "token" | "oauth"
): Promise<Resultado_Validacion_Token_IA> {
  try {
    const Supa_Servicio =
      Crear_Supabase_Servicio();
    const Token_Hash = await Hash_Token(Token_IA);
    const {
      data: Token_Registro,
      error: Error_Token,
    } = await Supa_Servicio
      .from("tokens_ia_usuario")
      .select(
        "id, usuario_id, scopes, revocado_en"
      )
      .eq("token_hash", Token_Hash)
      .maybeSingle();

    if (Error_Token) {
      console.error(
        "Error validando token IA:",
        Error_Token
      );
      return {
        Encontrado: false,
        Resultado: {
          Ok: false,
          Status: 500,
          Error: "Error interno",
          Detalle:
            "No se pudo validar el token de IA.",
        },
      };
    }

    if (!Token_Registro) {
      return {
        Encontrado: false,
        Resultado: null,
      };
    }

    if (Token_Registro.revocado_en) {
      return {
        Encontrado: true,
        Resultado: {
          Ok: false,
          Status: 403,
          Error: "Token revocado",
          Detalle:
            "El token de IA fue revocado.",
        },
      };
    }

    if (
      !Tiene_Scope_Lectura(
        Token_Registro.scopes
      )
    ) {
      return {
        Encontrado: true,
        Resultado: {
          Ok: false,
          Status: 403,
          Error: "Scope insuficiente",
          Detalle:
            "El token no tiene permiso de lectura.",
        },
      };
    }

    await Supa_Servicio
      .from("tokens_ia_usuario")
      .update({
        ultimo_uso_en:
          new Date().toISOString(),
      })
      .eq("id", Token_Registro.id);

    const Scopes = Array.isArray(
      Token_Registro.scopes
    )
      ? Token_Registro.scopes
        .map((Scope) =>
          String(Scope || "").trim()
        )
        .filter(Boolean)
      : [];

    return {
      Encontrado: true,
      Resultado: {
        Ok: true,
        Usuario_Id: String(
          Token_Registro.usuario_id
        ),
        Fuente: Fuente_Exito,
        Scopes,
      },
    };
  } catch (Error_General) {
    console.error(
      "Error general validando token IA:",
      Error_General
    );
    return {
      Encontrado: false,
      Resultado: {
        Ok: false,
        Status: 500,
        Error: "Error interno",
        Detalle:
          "No se pudo validar el token de IA.",
      },
    };
  }
}

async function Validar_Request(
  Req: Request
): Promise<Auth_Resultado> {
  const Token_IA = String(
    Req.headers.get("X-Semaplan-AI-Token") || ""
  ).trim();
  if (Token_IA) {
    const Validacion_Token =
      await Validar_Token_IA_Por_Valor(
        Token_IA,
        "token"
      );
    if (Validacion_Token.Resultado) {
      return Validacion_Token.Resultado;
    }
    return {
      Ok: false,
      Status: 401,
      Error: "No autorizado",
      Detalle: "Token invalido.",
    };
  }

  const Auth_Header = String(
    Req.headers.get("Authorization") || ""
  ).trim();
  if (
    Auth_Header &&
    Auth_Header.toLowerCase().startsWith(
      "bearer "
    )
  ) {
    const Bearer_Token = Auth_Header
      .slice(7)
      .trim();
    if (Bearer_Token) {
      const Validacion_OAuth =
        await Validar_Token_IA_Por_Valor(
          Bearer_Token,
          "oauth"
        );
      if (Validacion_OAuth.Resultado?.Ok) {
        return Validacion_OAuth.Resultado;
      }
      if (
        Validacion_OAuth.Resultado &&
        Validacion_OAuth.Encontrado
      ) {
        return Validacion_OAuth.Resultado;
      }
      if (
        Validacion_OAuth.Resultado &&
        !Validacion_OAuth.Resultado.Ok &&
        Validacion_OAuth.Resultado.Status >= 500
      ) {
        return Validacion_OAuth.Resultado;
      }
    }
    try {
      const Supa_Usuario =
        Crear_Supabase_Usuario(Auth_Header);
      const {
        data: { user: Usuario },
        error: Error_Auth,
      } = await Supa_Usuario.auth.getUser();

      if (Error_Auth || !Usuario) {
        return {
          Ok: false,
          Status: 401,
          Error: "Sesion invalida",
          Detalle:
            "No se pudo validar el JWT del usuario.",
        };
      }

      return {
        Ok: true,
        Usuario_Id: Usuario.id,
        Fuente: "jwt",
        Scopes: [OAUTH_SCOPE_LECTURA],
      };
    } catch (Error_General) {
      console.error(
        "Error general validando JWT:",
        Error_General
      );
      return {
        Ok: false,
        Status: 500,
        Error: "Error interno",
        Detalle:
          "No se pudo validar la sesion.",
      };
    }
  }

  return {
    Ok: false,
    Status: 401,
    Error: "No autorizado",
    Detalle:
      "Falta X-Semaplan-AI-Token o Authorization.",
  };
}

function Filtrar_Campos_Seguros(
  Estado_Raw: unknown
) {
  const Estado =
    Estado_Raw &&
    typeof Estado_Raw === "object" &&
    !Array.isArray(Estado_Raw)
      ? (Estado_Raw as Record<string, unknown>)
      : {};
  const Resultado: Record<string, unknown> = {};
  Object.entries(Estado).forEach(
    ([Clave, Valor]) => {
      if (!Claves_Estado_Seguras.has(Clave)) {
        return;
      }
      Resultado[Clave] = Valor;
    }
  );
  return Resultado;
}

async function Leer_Estado_Usuario(
  Usuario_Id: string
): Promise<Estado_Resultado> {
  try {
    const Supa_Servicio =
      Crear_Supabase_Servicio();
    const {
      data: Fila_Estado,
      error: Error_Estado,
    } = await Supa_Servicio
      .from("estado_usuario")
      .select(
        "user_id, estado, version, actualizado_en"
      )
      .eq("user_id", Usuario_Id)
      .maybeSingle();

    if (Error_Estado) {
      console.error(
        "Error leyendo estado_usuario:",
        Error_Estado
      );
      return {
        Ok: false,
        Status: 500,
        Error: "Error interno",
        Detalle:
          "No se pudo leer el estado del usuario.",
      };
    }

    if (!Fila_Estado) {
      return {
        Ok: false,
        Status: 404,
        Error: "Estado inexistente",
        Detalle:
          "No existe un estado remoto para el usuario.",
      };
    }

    return {
      Ok: true,
      Estado: Filtrar_Campos_Seguros(
        Fila_Estado.estado
      ),
      Version:
        Number(Fila_Estado.version) || 1,
      Actualizado_En:
        typeof Fila_Estado.actualizado_en ===
          "string"
          ? Fila_Estado.actualizado_en
          : null,
    };
  } catch (Error_General) {
    console.error(
      "Error general leyendo estado del usuario:",
      Error_General
    );
    return {
      Ok: false,
      Status: 500,
      Error: "Error interno",
      Detalle:
        "No se pudo leer el estado del usuario.",
    };
  }
}

type Rango_Resultado =
  | {
    Ok: true;
    Desde: string;
    Hasta: string;
  }
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

type Resultado_Con_Error<T> =
  | ({ Ok: true } & T)
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

function Es_Fecha_ISO_Valida(Valor: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(Valor);
}

function Parsear_Fecha_ISO(
  Valor: string
) {
  if (!Es_Fecha_ISO_Valida(Valor)) {
    return null;
  }
  const Fecha = new Date(`${Valor}T00:00:00.000Z`);
  return Number.isNaN(Fecha.getTime())
    ? null
    : Fecha;
}

function Formatear_Fecha_ISO(
  Fecha: Date
) {
  return Fecha.toISOString().slice(0, 10);
}

function Sumar_Dias(
  Fecha: Date,
  Dias: number
) {
  const Copia = new Date(Fecha.getTime());
  Copia.setUTCDate(Copia.getUTCDate() + Dias);
  return Copia;
}

function Obtener_Hoy_ISO() {
  return Formatear_Fecha_ISO(new Date());
}

function Resolver_Rango(
  Url: URL
): Rango_Resultado {
  const Desde_Raw = String(
    Url.searchParams.get("desde") || ""
  ).trim();
  const Hasta_Raw = String(
    Url.searchParams.get("hasta") || ""
  ).trim();

  let Desde = Desde_Raw;
  let Hasta = Hasta_Raw;

  if (!Desde && !Hasta) {
    Desde = Obtener_Hoy_ISO();
    Hasta = Formatear_Fecha_ISO(
      Sumar_Dias(Parsear_Fecha_ISO(Desde)!, 6)
    );
  } else if (Desde && !Hasta) {
    Hasta = Desde;
  } else if (!Desde && Hasta) {
    Desde = Hasta;
  }

  const Desde_Fecha = Parsear_Fecha_ISO(Desde);
  const Hasta_Fecha = Parsear_Fecha_ISO(Hasta);
  if (!Desde_Fecha || !Hasta_Fecha) {
    return {
      Ok: false,
      Status: 400,
      Error: "Rango invalido",
      Detalle:
        "Las fechas deben usar formato YYYY-MM-DD.",
    };
  }

  if (Hasta < Desde) {
    return {
      Ok: false,
      Status: 400,
      Error: "Rango invalido",
      Detalle:
        "`hasta` no puede ser menor que `desde`.",
    };
  }

  const Dias = Math.floor(
    (Hasta_Fecha.getTime() -
      Desde_Fecha.getTime()) /
      86400000
  ) + 1;
  if (Dias > 45) {
    return {
      Ok: false,
      Status: 400,
      Error: "Rango excedido",
      Detalle:
        "El rango maximo permitido es de 45 dias.",
    };
  }

  return {
    Ok: true,
    Desde,
    Hasta,
  };
}

function Resolver_Rango_Optional(
  Url: URL
): Resultado_Con_Error<{
  Desde: string | null;
  Hasta: string | null;
}> {
  const Tiene_Desde = Url.searchParams.has(
    "desde"
  );
  const Tiene_Hasta = Url.searchParams.has(
    "hasta"
  );
  if (!Tiene_Desde && !Tiene_Hasta) {
    return {
      Ok: true,
      Desde: null,
      Hasta: null,
    };
  }
  const Rango = Resolver_Rango(Url);
  if (!Rango.Ok) {
    return Rango;
  }
  return {
    Ok: true,
    Desde: Rango.Desde,
    Hasta: Rango.Hasta,
  };
}

function Resolver_Limite(
  Url: URL,
  Default = 50,
  Maximo = 100
) {
  const Raw = String(
    Url.searchParams.get("limite") || ""
  ).trim();
  if (!Raw) {
    return Default;
  }
  const Numero = Math.floor(Number(Raw));
  if (!Number.isFinite(Numero) || Numero <= 0) {
    return Default;
  }
  return Math.min(Maximo, Numero);
}

function Resolver_Offset(Url: URL) {
  const Raw = String(
    Url.searchParams.get("offset") || ""
  ).trim();
  if (!Raw) return 0;
  const Numero = Math.floor(Number(Raw));
  if (!Number.isFinite(Numero) || Numero < 0) return 0;
  return Numero;
}

function Resolver_Filtros_Decoteca(Url: URL) {
  const Filtros: Mapa = {};
  const Raw = Normalizar_Texto(
    Url.searchParams.get("filtros")
  );
  if (Raw) {
    try {
      const Parseados = JSON.parse(Raw);
      if (Es_Mapa_B2(Parseados)) {
        Object.assign(Filtros, Parseados);
      }
    } catch (_) {
      // Tambien se admite la sintaxis deepObject de OpenAPI.
    }
  }
  Url.searchParams.forEach((Valor, Clave) => {
    const Coincidencia = Clave.match(/^filtros\[([^\]]+)\]$/);
    if (Coincidencia) {
      Filtros[Coincidencia[1]] = Valor;
    }
  });
  [
    "descripcion_vacia",
    "creador_vacio",
    "anio_vacio",
    "genero_vacio",
    "subgenero_vacio",
    "portada_vacia",
    "total_unidades_cero",
    "estado",
    "periodo",
    "prioridad",
  ].forEach((Clave) => {
    if (
      !Object.prototype.hasOwnProperty.call(Filtros, Clave) &&
      Url.searchParams.has(Clave)
    ) {
      Filtros[Clave] = Url.searchParams.get(Clave);
    }
  });
  [
    "descripcion_vacia",
    "creador_vacio",
    "anio_vacio",
    "genero_vacio",
    "subgenero_vacio",
    "portada_vacia",
    "total_unidades_cero",
  ].forEach((Clave) => {
    if (!Object.prototype.hasOwnProperty.call(Filtros, Clave)) {
      return;
    }
    const Valor = Filtros[Clave];
    if (typeof Valor === "boolean") return;
    const Texto = Normalizar_Texto_Busqueda(Valor);
    if (["true", "1", "si"].includes(Texto)) {
      Filtros[Clave] = true;
    } else if (["false", "0", "no"].includes(Texto)) {
      Filtros[Clave] = false;
    }
  });
  return Filtros;
}

function Resolver_Compacto_Decoteca(Url: URL) {
  const Payload: Mapa = {
    compacto: Url.searchParams.get("compacto"),
  };
  return Leer_Boolean_B2(Payload, false, "compacto");
}

function Resolver_Fecha_Referencia(
  Url: URL,
  Parametro = "fecha"
): Resultado_Con_Error<{
  Fecha: string;
}> {
  const Fecha = Normalizar_Texto(
    Url.searchParams.get(Parametro)
  ) || Obtener_Hoy_ISO();
  if (!Es_Fecha_ISO_Valida(Fecha)) {
    return {
      Ok: false,
      Status: 400,
      Error: "Fecha invalida",
      Detalle:
        "La fecha debe usar formato YYYY-MM-DD.",
    };
  }
  return {
    Ok: true,
    Fecha,
  };
}

function Obtener_Lunes_ISO_Desde_Fecha(
  Fecha: string
) {
  const Base = Parsear_Fecha_ISO(Fecha);
  if (!Base) {
    return null;
  }
  return Formatear_Fecha_ISO(
    Obtener_Lunes_UTC(Base)
  );
}

function Resolver_Semana(
  Url: URL
): Resultado_Con_Error<{
  Semana: string;
}> {
  const Semana_Raw = Normalizar_Texto(
    Url.searchParams.get("semana")
  ) || Obtener_Hoy_ISO();
  if (!Es_Fecha_ISO_Valida(Semana_Raw)) {
    return {
      Ok: false,
      Status: 400,
      Error: "Semana invalida",
      Detalle:
        "La semana debe usar formato YYYY-MM-DD.",
    };
  }
  const Semana = Obtener_Lunes_ISO_Desde_Fecha(
    Semana_Raw
  );
  if (!Semana) {
    return {
      Ok: false,
      Status: 400,
      Error: "Semana invalida",
      Detalle:
        "No se pudo resolver la semana pedida.",
    };
  }
  return {
    Ok: true,
    Semana,
  };
}

function Obtener_Array_Estado(
  Estado: Record<string, unknown>,
  Clave: string
) {
  return Array.isArray(Estado[Clave])
    ? Estado[Clave] as unknown[]
    : [];
}

function Obtener_Objeto_Estado(
  Estado: Record<string, unknown>,
  Clave: string
) {
  const Valor = Estado[Clave];
  return Valor &&
      typeof Valor === "object" &&
      !Array.isArray(Valor)
    ? Valor as Record<string, unknown>
    : {};
}

function Normalizar_Texto(
  Valor: unknown
) {
  return String(Valor || "").trim();
}

function Normalizar_Texto_Busqueda(
  Valor: unknown
) {
  return Normalizar_Texto(Valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function Limitar_Texto_IA(
  Texto: string,
  Maximo = 1000
) {
  if (Texto.length <= Maximo) {
    return {
      Texto,
      Texto_Truncado: false,
    };
  }
  return {
    Texto: `${Texto.slice(0, Maximo)}...`,
    Texto_Truncado: true,
  };
}

function Normalizar_Marca_Tiempo_IA(
  Valor: unknown
) {
  if (
    typeof Valor === "number" &&
    Number.isFinite(Valor)
  ) {
    return Valor;
  }
  const Texto = Normalizar_Texto(Valor);
  return Texto || null;
}

function Numero_Entero(
  Valor: unknown,
  Fallback = 0
) {
  const Numero = Math.round(Number(Valor));
  return Number.isFinite(Numero)
    ? Numero
    : Fallback;
}

function Formatear_Hora(
  Hora: number
) {
  const Valor = Math.max(
    0,
    Math.min(24, Math.round(Hora))
  );
  return `${String(Valor).padStart(2, "0")}:00`;
}

function Construir_Mapa_Por_Id(
  Lista: unknown[]
) {
  const Mapa: Record<string, Record<string, unknown>> =
    {};
  Lista.forEach((Item) => {
    if (!Item || typeof Item !== "object") {
      return;
    }
    const Id = Normalizar_Texto(
      (Item as Record<string, unknown>).Id
    );
    if (!Id) {
      return;
    }
    Mapa[Id] = Item as Record<string, unknown>;
  });
  return Mapa;
}

function Parsear_Clave_Slot(
  Clave_Raw: unknown
) {
  const Clave = Normalizar_Texto(Clave_Raw);
  const [Fecha, Hora_Raw] = Clave.split("|");
  if (!Es_Fecha_ISO_Valida(Fecha)) {
    return null;
  }
  const Hora = Numero_Entero(Hora_Raw, -1);
  if (Hora < 0 || Hora > 23) {
    return null;
  }
  return {
    Clave,
    Fecha,
    Hora,
  };
}

function Normalizar_Plan_Slot_IA(
  Plan_Raw: unknown
) {
  if (
    !Plan_Raw ||
    typeof Plan_Raw !== "object" ||
    Array.isArray(Plan_Raw)
  ) {
    return null;
  }
  const Plan = Plan_Raw as Record<string, unknown>;
  const Items = Array.isArray(Plan.Items)
    ? Plan.Items
      .filter((Item) =>
        Item && typeof Item === "object"
      )
      .map((Item) => {
        const Base =
          Item as Record<string, unknown>;
        return {
          Id: Normalizar_Texto(Base.Id),
          Emoji: Normalizar_Texto(
            Base.Emoji || "\u2022"
          ),
          Texto: Normalizar_Texto(Base.Texto),
          Estado: Normalizar_Texto(
            Base.Estado || "Planeado"
          ),
          Tarea_Id: Normalizar_Texto(
            Base.Tarea_Id
          ),
        };
      })
      .filter((Item) => Item.Texto || Item.Tarea_Id)
    : [];
  const Nota = Normalizar_Texto(Plan.Nota);
  if (!Items.length && !Nota) {
    return null;
  }
  return {
    Items,
    Nota,
  };
}

function Construir_Bloques_Agenda(
  Estado: Record<string, unknown>,
  Desde: string,
  Hasta: string
) {
  const Objetivos = Obtener_Array_Estado(
    Estado,
    "Objetivos"
  );
  const Categorias = Obtener_Array_Estado(
    Estado,
    "Categorias"
  );
  const Tipos_Slot = Obtener_Array_Estado(
    Estado,
    "Tipos_Slot"
  );
  const Eventos = Obtener_Array_Estado(
    Estado,
    "Eventos"
  );
  const Slots_Muertos = Obtener_Array_Estado(
    Estado,
    "Slots_Muertos"
  );
  const Planes_Slot = Obtener_Objeto_Estado(
    Estado,
    "Planes_Slot"
  );
  const Slots_Muertos_Tipos =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Tipos"
    );
  const Slots_Muertos_Nombres =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Nombres"
    );
  const Slots_Muertos_Titulos_Visibles =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Titulos_Visibles"
    );

  const Objetivos_Por_Id =
    Construir_Mapa_Por_Id(Objetivos);
  const Categorias_Por_Id =
    Construir_Mapa_Por_Id(Categorias);
  const Tipos_Slot_Por_Id =
    Construir_Mapa_Por_Id(Tipos_Slot);

  const Bloques: Record<string, unknown>[] = [];
  const Claves_Ocupadas = new Set<string>();
  const Claves_Slots_Muertos = new Set<string>();

  Eventos.forEach((Evento_Raw) => {
    if (
      !Evento_Raw ||
      typeof Evento_Raw !== "object"
    ) {
      return;
    }
    const Evento =
      Evento_Raw as Record<string, unknown>;
    const Fecha = Normalizar_Texto(
      Evento.Fecha
    );
    if (
      !Es_Fecha_ISO_Valida(Fecha) ||
      Fecha < Desde ||
      Fecha > Hasta
    ) {
      return;
    }

    const Inicio = Numero_Entero(
      Evento.Inicio,
      0
    );
    const Duracion = Math.max(
      1,
      Numero_Entero(Evento.Duracion, 1)
    );
    for (
      let Hora = Inicio;
      Hora < Inicio + Duracion;
      Hora += 1
    ) {
      Claves_Ocupadas.add(`${Fecha}|${Hora}`);
    }

    const Objetivo_Id = Normalizar_Texto(
      Evento.Objetivo_Id
    );
    const Objetivo =
      Objetivos_Por_Id[Objetivo_Id] || null;
    const Categoria_Id = Normalizar_Texto(
      Objetivo?.Categoria_Id
    );
    const Categoria =
      Categorias_Por_Id[Categoria_Id] || null;

    Bloques.push({
      Id:
        Normalizar_Texto(Evento.Id) ||
        `Evento_${Fecha}_${Inicio}`,
      Fecha,
      Inicio: Formatear_Hora(Inicio),
      Fin: Formatear_Hora(
        Math.min(24, Inicio + Duracion)
      ),
      Titulo:
        Normalizar_Texto(Objetivo?.Nombre) ||
        Normalizar_Texto(Evento.Titulo) ||
        "Evento",
      Tipo: "Evento",
      Objetivo_Id: Objetivo_Id || null,
      Objetivo_Nombre: Normalizar_Texto(
        Objetivo?.Nombre
      ),
      Categoria: Normalizar_Texto(
        Categoria?.Nombre
      ),
      Nota: Normalizar_Texto(Evento.Nota),
      Estado: "Planeado",
      Origen: "Calendario",
      Plan_Slot: null,
    });
  });

  Slots_Muertos.forEach((Item) => {
    const Slot =
      typeof Item === "string"
        ? Parsear_Clave_Slot(Item)
        : Parsear_Clave_Slot(
          (Item as Record<string, unknown>)
            ?.Clave ||
            `${Normalizar_Texto(
              (Item as Record<string, unknown>)
                ?.Fecha
            )}|${Numero_Entero(
              (Item as Record<string, unknown>)
                ?.Hora,
              -1
            )}`
        );
    if (!Slot) {
      return;
    }
    if (
      Slot.Fecha < Desde ||
      Slot.Fecha > Hasta
    ) {
      return;
    }
    Claves_Slots_Muertos.add(Slot.Clave);
    const Tipo_Id = Normalizar_Texto(
      Slots_Muertos_Tipos[Slot.Clave]
    );
    const Tipo_Slot =
      Tipos_Slot_Por_Id[Tipo_Id] || null;
    const Nombre = Normalizar_Texto(
      Slots_Muertos_Nombres[Slot.Clave]
    );
    const Titulo_Visible = Boolean(
      Slots_Muertos_Titulos_Visibles[
        Slot.Clave
      ]
    );
    const Plan_Slot = Normalizar_Plan_Slot_IA(
      Planes_Slot[Slot.Clave]
    );

    Bloques.push({
      Id: `Slot_${Slot.Clave}`,
      Fecha: Slot.Fecha,
      Inicio: Formatear_Hora(Slot.Hora),
      Fin: Formatear_Hora(
        Math.min(24, Slot.Hora + 1)
      ),
      Titulo:
        (Titulo_Visible && Nombre) ||
        Nombre ||
        Normalizar_Texto(Tipo_Slot?.Titulo) ||
        Normalizar_Texto(Tipo_Slot?.Nombre) ||
        "Slot muerto",
      Tipo: "Slot_Muerto",
      Objetivo_Id: null,
      Objetivo_Nombre: "",
      Categoria: "",
      Nota: Plan_Slot?.Nota || "",
      Estado: Plan_Slot ? "Planeado" : "Libre",
      Origen: "Slot_Muerto",
      Tipo_Slot_Id: Tipo_Id || null,
      Tipo_Slot_Nombre: Normalizar_Texto(
        Tipo_Slot?.Nombre
      ),
      Plan_Slot,
    });
  });

  Object.entries(Planes_Slot).forEach(
    ([Clave, Plan_Raw]) => {
      const Slot = Parsear_Clave_Slot(Clave);
      if (!Slot) {
        return;
      }
      if (
        Slot.Fecha < Desde ||
        Slot.Fecha > Hasta ||
        Claves_Slots_Muertos.has(Slot.Clave) ||
        Claves_Ocupadas.has(Slot.Clave)
      ) {
        return;
      }
      const Plan_Slot =
        Normalizar_Plan_Slot_IA(Plan_Raw);
      if (!Plan_Slot) {
        return;
      }
      const Primer_Item = Plan_Slot.Items[0];
      Bloques.push({
        Id: `Plan_${Slot.Clave}`,
        Fecha: Slot.Fecha,
        Inicio: Formatear_Hora(Slot.Hora),
        Fin: Formatear_Hora(
          Math.min(24, Slot.Hora + 1)
        ),
        Titulo:
          Normalizar_Texto(Primer_Item?.Texto) ||
          "Slot con plan",
        Tipo: "Slot_Vacio",
        Objetivo_Id: null,
        Objetivo_Nombre: "",
        Categoria: "",
        Nota: Plan_Slot.Nota || "",
        Estado: "Planeado",
        Origen: "Plan_Slot",
        Plan_Slot,
      });
    }
  );

  Bloques.sort((A, B) => {
    const Fecha_A = Normalizar_Texto(A.Fecha);
    const Fecha_B = Normalizar_Texto(B.Fecha);
    if (Fecha_A !== Fecha_B) {
      return Fecha_A.localeCompare(Fecha_B);
    }
    const Inicio_A = Normalizar_Texto(A.Inicio);
    const Inicio_B = Normalizar_Texto(B.Inicio);
    if (Inicio_A !== Inicio_B) {
      return Inicio_A.localeCompare(Inicio_B);
    }
    return Normalizar_Texto(A.Tipo)
      .localeCompare(Normalizar_Texto(B.Tipo));
  });

  return Bloques;
}

function Construir_Resumen_Tareas(
  Estado: Record<string, unknown>,
  Desde: string,
  Hasta: string
) {
  const Tareas =
    Construir_Tareas_Normalizadas_IA(Estado);

  const En_Rango = Tareas
    .filter((Tarea) =>
      Tarea.Fecha &&
      Tarea.Fecha >= Desde &&
      Tarea.Fecha <= Hasta
    )
    .sort((A, B) =>
      `${A.Fecha}|${A.Hora}`.localeCompare(
        `${B.Fecha}|${B.Hora}`
      )
    );

  return {
    Total: Tareas.length,
    Pendientes: Tareas.filter((Tarea) =>
      Tarea.Estado === "pendiente"
    ).length,
    Realizadas: Tareas.filter((Tarea) =>
      Tarea.Estado === "completada"
    ).length,
    Pospuestas: Tareas.filter((Tarea) =>
      Tarea.Estado === "pospuesta"
    ).length,
    Proximas: En_Rango.slice(0, 12),
  };
}

function Construir_Resumen_Habitos(
  Estado: Record<string, unknown>,
  Desde: string,
  Hasta: string
) {
  const Habitos =
    Construir_Habitos_Normalizados_IA(Estado);
  const Registros =
    Construir_Registros_Habitos_IA(Estado);

  const Registros_En_Rango = Registros
    .filter((Registro) =>
      Registro.Fecha &&
      Registro.Fecha >= Desde &&
      Registro.Fecha <= Hasta
    )
    .sort((A, B) =>
      `${B.Fecha}|${B.Hora}`.localeCompare(
        `${A.Fecha}|${A.Hora}`
      )
    );

  return {
    Total: Habitos.length,
    Activos: Habitos.filter((Habito) =>
      Habito.Activo && !Habito.Archivado
    ).length,
    Archivados: Habitos.filter((Habito) =>
      Habito.Archivado
    ).length,
    Registros_En_Rango: Registros_En_Rango.length,
    Destacados: Habitos
      .filter((Habito) => !Habito.Archivado)
      .slice(0, 12),
    Registros_Recientes:
      Registros_En_Rango.slice(0, 12),
  };
}

function Construir_Resumen_Slots(
  Estado: Record<string, unknown>
) {
  const Slots_Muertos = Obtener_Array_Estado(
    Estado,
    "Slots_Muertos"
  );
  const Planes_Slot = Obtener_Objeto_Estado(
    Estado,
    "Planes_Slot"
  );
  const Tipos_Slot = Obtener_Array_Estado(
    Estado,
    "Tipos_Slot"
  );

  return {
    Slots_Muertos_Total:
      Slots_Muertos.length,
    Con_Plan_Total: Object.keys(Planes_Slot)
      .filter((Clave) =>
        Boolean(
          Normalizar_Plan_Slot_IA(
            Planes_Slot[Clave]
          )
        )
      )
      .length,
    Tipos_Total: Tipos_Slot.length,
  };
}

function Construir_Resumen_Planes_Semana(
  Estado: Record<string, unknown>,
  Desde: string,
  Hasta: string
) {
  const Planes_Semana =
    Obtener_Objeto_Estado(
      Estado,
      "Planes_Semana"
    );
  const Semanas = Object.keys(Planes_Semana)
    .filter(Es_Fecha_ISO_Valida)
    .sort();
  return {
    Total: Semanas.length,
    Semanas_En_Rango: Semanas.filter(
      (Semana) =>
        Semana >= Desde && Semana <= Hasta
    ).length,
    Claves: Semanas.slice(0, 12),
  };
}

function Construir_Resumen_Planes_Periodo(
  Estado: Record<string, unknown>
) {
  const Planes_Periodo =
    Obtener_Objeto_Estado(
      Estado,
      "Planes_Periodo"
    );
  const Periodos = Object.values(Planes_Periodo)
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id:
          Normalizar_Texto(Base.Id) ||
          Normalizar_Texto(Base.Periodo_Id),
        Nombre: Normalizar_Texto(Base.Nombre),
        Tipo: Normalizar_Texto(Base.Tipo),
        Estado: Normalizar_Texto(Base.Estado),
        Fecha_Inicio: Normalizar_Texto(
          Base.Fecha_Inicio
        ),
        Fecha_Fin: Normalizar_Texto(
          Base.Fecha_Fin
        ),
      };
    })
    .filter((Periodo) =>
      Periodo.Id || Periodo.Nombre
    );

  return {
    Total: Periodos.length,
    Destacados: Periodos.slice(0, 12),
  };
}

function Construir_Resumen_Archivero(
  Estado: Record<string, unknown>
) {
  const Archiveros = Obtener_Array_Estado(
    Estado,
    "Archiveros"
  );
  const Notas = Obtener_Array_Estado(
    Estado,
    "Notas_Archivero"
  );
  const Etiquetas = Obtener_Array_Estado(
    Estado,
    "Etiquetas_Archivero"
  );

  const Cantidad_Por_Cajon: Record<
    string,
    number
  > = {};
  Notas.forEach((Nota) => {
    if (!Nota || typeof Nota !== "object") {
      return;
    }
    const Cajon_Id = Normalizar_Texto(
      (Nota as Record<string, unknown>)
        .Archivero_Id
    );
    if (!Cajon_Id) {
      return;
    }
    Cantidad_Por_Cajon[Cajon_Id] =
      (Cantidad_Por_Cajon[Cajon_Id] || 0) + 1;
  });

  const Cajones = Archiveros
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      const Id = Normalizar_Texto(Base.Id);
      return {
        Id,
        Nombre: Normalizar_Texto(Base.Nombre),
        Notas_Total:
          Cantidad_Por_Cajon[Id] || 0,
      };
    })
    .filter((Cajon) => Cajon.Nombre);

  return {
    Cajones_Total: Archiveros.length,
    Notas_Total: Notas.length,
    Etiquetas_Total: Etiquetas.length,
    Cajones: Cajones.slice(0, 12),
  };
}

function Construir_Resumen_Baul(
  Estado: Record<string, unknown>
) {
  const Baul = Obtener_Array_Estado(
    Estado,
    "Baul_Objetivos"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Nombre: Normalizar_Texto(Base.Nombre),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Estado: Normalizar_Texto(Base.Estado),
        Archivada: Base.Archivada === true,
        Timeline: Normalizar_Texto(
          Base.Timeline
        ),
      };
    })
    .filter((Objetivo) => Objetivo.Nombre);

  return {
    Total: Baul.length,
    Activas: Baul.filter((Objetivo) =>
      !Objetivo.Archivada
    ).length,
    Archivadas: Baul.filter((Objetivo) =>
      Objetivo.Archivada
    ).length,
    Destacadas: Baul
      .filter((Objetivo) => !Objetivo.Archivada)
      .slice(0, 12),
  };
}

function Construir_Resumen_Metas(
  Estado: Record<string, unknown>
) {
  const Metas = Obtener_Array_Estado(
    Estado,
    "Metas"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Nombre: Normalizar_Texto(Base.Nombre),
        Periodo: Normalizar_Texto(
          Base.Periodo
        ),
        Fecha_Desde: Normalizar_Texto(
          Base.Fecha_Desde
        ),
        Fecha_Hasta: Normalizar_Texto(
          Base.Fecha_Hasta
        ),
        Archivada: Base.Archivada === true,
      };
    })
    .filter((Meta) => Meta.Nombre);

  return {
    Total: Metas.length,
    Activas: Metas.filter((Meta) =>
      !Meta.Archivada
    ).length,
    Archivadas: Metas.filter((Meta) =>
      Meta.Archivada
    ).length,
    Destacadas: Metas
      .filter((Meta) => !Meta.Archivada)
      .slice(0, 12),
  };
}

function Construir_Cajones_Archivero_IA(
  Estado: Record<string, unknown>
) {
  const Archiveros = Obtener_Array_Estado(
    Estado,
    "Archiveros"
  );
  const Notas = Obtener_Array_Estado(
    Estado,
    "Notas_Archivero"
  );
  const Conteo_Por_Cajon: Record<string, number> =
    {};
  Notas.forEach((Nota) => {
    if (!Nota || typeof Nota !== "object") {
      return;
    }
    const Cajon_Id = Normalizar_Texto(
      (Nota as Record<string, unknown>)
        .Archivero_Id
    );
    if (!Cajon_Id) {
      return;
    }
    Conteo_Por_Cajon[Cajon_Id] =
      (Conteo_Por_Cajon[Cajon_Id] || 0) + 1;
  });
  return Archiveros
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      const Id = Normalizar_Texto(Base.Id);
      return {
        Id,
        Nombre: Normalizar_Texto(Base.Nombre),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\ud83d\uddc2\ufe0f"
        ),
        Notas_Total:
          Conteo_Por_Cajon[Id] || 0,
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
      };
    })
    .filter((Cajon) => Cajon.Id && Cajon.Nombre);
}

function Construir_Notas_Archivero_IA(
  Estado: Record<string, unknown>
) {
  return Obtener_Array_Estado(
    Estado,
    "Notas_Archivero"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      const Titulo = Normalizar_Texto(
        Base.Titulo
      );
      const Texto_Completo = Normalizar_Texto(
        Base.Texto
      );
      const Texto_Limitado =
        Limitar_Texto_IA(Texto_Completo);
      const Etiquetas = Array.isArray(
        Base.Etiquetas
      )
        ? Base.Etiquetas
          .map((Etiqueta) =>
            Normalizar_Texto(Etiqueta)
          )
          .filter(Boolean)
        : [];
      const Origen = Normalizar_Texto(
        Base.Origen
      );
      const Fecha_Creacion =
        Normalizar_Marca_Tiempo_IA(
          Base.Fecha_Creacion ??
            Base.Creado_En
        );
      const Fecha_Actualizacion =
        Normalizar_Marca_Tiempo_IA(
          Base.Fecha_Actualizacion ??
            Base.Actualizado_En
        );
      return {
        Id:
          Normalizar_Texto(Base.Id) ||
          `Nota_${Indice}`,
        Archivero_Id: Normalizar_Texto(
          Base.Archivero_Id
        ),
        Titulo: Titulo || null,
        Texto: Texto_Limitado.Texto,
        Texto_Truncado:
          Texto_Limitado.Texto_Truncado,
        Etiquetas,
        Origen,
        Tipo:
          Normalizar_Texto(Base.Tipo) ||
          "Texto",
        Fecha_Creacion,
        Fecha_Actualizacion,
        Adjuntos_Total: Array.isArray(
          Base.Adjuntos
        )
          ? Base.Adjuntos.length
          : 0,
        _Orden_Fecha:
          Fecha_Actualizacion ??
          Fecha_Creacion ??
          0,
        _Busqueda: Normalizar_Texto_Busqueda(
          [
            Titulo,
            Texto_Completo,
            Origen,
            ...Etiquetas,
          ].join(" ")
        ),
      };
    })
    .filter((Nota) => Nota.Archivero_Id);
}

function Construir_Baul_Normalizado_IA(
  Estado: Record<string, unknown>
) {
  const Categorias_Por_Id =
    Construir_Mapa_Por_Id(
      Obtener_Array_Estado(
        Estado,
        "Categorias"
      )
    );
  const Etiquetas_Por_Id =
    Construir_Mapa_Por_Id(
      Obtener_Array_Estado(
        Estado,
        "Etiquetas"
      )
    );
  return Obtener_Array_Estado(
    Estado,
    "Baul_Objetivos"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      const Categoria_Id = Normalizar_Texto(
        Base.Categoria_Id
      );
      const Categoria =
        Categorias_Por_Id[Categoria_Id] || null;
      const Etiquetas_Ids = Array.isArray(
        Base.Etiquetas_Ids
      )
        ? Base.Etiquetas_Ids
          .map((Id) => Normalizar_Texto(Id))
          .filter(Boolean)
        : [];
      const Metadatos_Categoria =
        Array.isArray(Categoria?.Metadatos)
          ? Categoria.Metadatos
          : [];
      const Nombres_Metadatos = new Map(
        Metadatos_Categoria
          .filter((Meta) =>
            Meta && typeof Meta === "object"
          )
          .map((Meta) => {
            const Base_Meta =
              Meta as Record<string, unknown>;
            return [
              Normalizar_Texto(Base_Meta.Id),
              Normalizar_Texto(
                Base_Meta.Nombre
              ),
            ];
          })
      );
      const Metadatos_Raw =
        Base.Metadatos &&
          typeof Base.Metadatos === "object" &&
          !Array.isArray(Base.Metadatos)
          ? Base.Metadatos as Record<
              string,
              unknown
            >
          : {};
      const Metadatos = Object.entries(
        Metadatos_Raw
      ).reduce<Record<string, string>>(
        (Acumulado, [Clave, Valor]) => {
          const Texto = Normalizar_Texto(Valor);
          if (!Texto) {
            return Acumulado;
          }
          Acumulado[
            Nombres_Metadatos.get(Clave) ||
              Clave
          ] = Texto;
          return Acumulado;
        },
        {}
      );
      return {
        Id:
          Normalizar_Texto(Base.Id) ||
          `Baul_${Indice}`,
        Nombre: Normalizar_Texto(Base.Nombre),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Estado:
          Normalizar_Texto(Base.Estado) ||
          "Activa",
        Archivada: Base.Archivada === true,
        Categoria_Id: Categoria_Id || null,
        Categoria: Normalizar_Texto(
          Categoria?.Nombre
        ),
        Etiquetas: Etiquetas_Ids
          .map((Etiqueta_Id) =>
            Normalizar_Texto(
              Etiquetas_Por_Id[Etiqueta_Id]
                ?.Nombre
            )
          )
          .filter(Boolean),
        Descripcion: Normalizar_Texto(
          Base.Descripcion
        ),
        Timeline: Normalizar_Texto(
          Base.Timeline
        ) || null,
        Horas_Aprox:
          Number(Base.Horas_Aprox) || 0,
        Metadatos,
        Orden: Number.isFinite(
          Number(Base.Orden_Personalizado)
        )
          ? Number(Base.Orden_Personalizado)
          : Indice,
      };
    })
    .filter((Objetivo) => Objetivo.Nombre);
}

function Resolver_Rango_Meta_IA(
  Meta: Record<string, unknown>
) {
  const Periodo =
    Normalizar_Texto(Meta.Periodo) ||
    "Semana";
  if (Periodo === "Semana") {
    const Semana =
      Obtener_Lunes_ISO_Desde_Fecha(
        Normalizar_Texto(
          Meta.Semana_Ref
        ) || Obtener_Hoy_ISO()
      ) || Obtener_Hoy_ISO();
    const Desde = Semana;
    const Hasta = Formatear_Fecha_ISO(
      Sumar_Dias(
        Parsear_Fecha_ISO(Semana)!,
        6
      )
    );
    return { Desde, Hasta };
  }
  if (Periodo === "Mes") {
    const Coincidencia = Normalizar_Texto(
      Meta.Mes_Ref
    ).match(/^(\d{4})-(\d{2})$/);
    if (Coincidencia) {
      const Ano = Number(Coincidencia[1]);
      const Mes = Number(Coincidencia[2]) - 1;
      const Desde = new Date(
        Date.UTC(Ano, Mes, 1)
      );
      const Hasta = new Date(
        Date.UTC(Ano, Mes + 1, 0)
      );
      return {
        Desde: Formatear_Fecha_ISO(Desde),
        Hasta: Formatear_Fecha_ISO(Hasta),
      };
    }
  }
  const Desde = Normalizar_Texto(
    Meta.Fecha_Desde
  );
  const Hasta = Normalizar_Texto(
    Meta.Fecha_Hasta
  );
  if (
    Es_Fecha_ISO_Valida(Desde) &&
    Es_Fecha_ISO_Valida(Hasta)
  ) {
    return {
      Desde,
      Hasta: Hasta >= Desde ? Hasta : Desde,
    };
  }
  const Hoy = Obtener_Hoy_ISO();
  return { Desde: Hoy, Hasta: Hoy };
}

function Calcular_Ratio_Tiempo_Meta_IA(
  Desde: string,
  Hasta: string
) {
  const Hoy = Obtener_Hoy_ISO();
  if (Hoy < Desde) {
    return 0;
  }
  if (Hoy > Hasta) {
    return 1;
  }
  const Inicio = Parsear_Fecha_ISO(Desde);
  const Fin = Parsear_Fecha_ISO(Hasta);
  const Actual = Parsear_Fecha_ISO(Hoy);
  if (!Inicio || !Fin || !Actual) {
    return 0;
  }
  const Total_Dias = Math.max(
    1,
    Math.round(
      (Fin.getTime() - Inicio.getTime()) /
        (24 * 3600 * 1000)
    ) + 1
  );
  const Transcurridos = Math.max(
    0,
    Math.round(
      (Actual.getTime() - Inicio.getTime()) /
        (24 * 3600 * 1000)
    ) + 1
  );
  return Math.max(
    0,
    Math.min(1, Transcurridos / Total_Dias)
  );
}

function Construir_Metas_Normalizadas_IA(
  Estado: Record<string, unknown>
) {
  const Metas = Obtener_Array_Estado(
    Estado,
    "Metas"
  );
  const Eventos = Obtener_Array_Estado(
    Estado,
    "Eventos"
  );
  const Objetivos_Por_Id =
    Construir_Mapa_Por_Id(
      Obtener_Array_Estado(
        Estado,
        "Objetivos"
      )
    );
  const Categorias_Por_Id =
    Construir_Mapa_Por_Id(
      Obtener_Array_Estado(
        Estado,
        "Categorias"
      )
    );
  const Etiquetas_Por_Id =
    Construir_Mapa_Por_Id(
      Obtener_Array_Estado(
        Estado,
        "Etiquetas"
      )
    );

  return Metas
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      const Nombre = Normalizar_Texto(
        Base.Nombre
      );
      const Objetivo =
        Number(Base.Horas_Objetivo) || 0;
      if (!Nombre) {
        return null;
      }
      const Periodo = [
        "Semana",
        "Mes",
        "Personalizado",
      ].includes(Normalizar_Texto(Base.Periodo))
        ? Normalizar_Texto(Base.Periodo)
        : "Semana";
      const Fuente_Tipo = [
        "Categoria",
        "Etiqueta",
        "Objetivo",
      ].includes(
        Normalizar_Texto(Base.Fuente_Tipo)
      )
        ? Normalizar_Texto(Base.Fuente_Tipo)
        : "Categoria";
      const Fuente_Valor =
        Fuente_Tipo === "Categoria"
          ? Normalizar_Texto(
              Base.Fuente_Valor ||
                Base.Categoria_Id
            )
          : Fuente_Tipo === "Etiqueta"
          ? Normalizar_Texto(
              Base.Fuente_Valor ||
                Base.Etiqueta_Id
            )
          : Normalizar_Texto(
              Base.Fuente_Valor ||
                Base.Objetivo_Nombre
            );
      const Fuente_Clave =
        Fuente_Tipo === "Objetivo"
          ? Normalizar_Texto_Busqueda(
              Base.Fuente_Clave ||
                Fuente_Valor
            )
          : Fuente_Valor;
      if (!Fuente_Valor) {
        return null;
      }
      const { Desde, Hasta } =
        Resolver_Rango_Meta_IA({
          ...Base,
          Periodo,
        });
      const Progreso = Eventos
        .filter((Evento) =>
          Evento && typeof Evento === "object"
        )
        .reduce<number>((Total, Evento) => {
          const Base_Evento =
            Evento as Record<string, unknown>;
          if (Base_Evento.Hecho !== true) {
            return Total;
          }
          const Fecha = Normalizar_Texto(
            Base_Evento.Fecha
          );
          if (
            !Es_Fecha_ISO_Valida(Fecha) ||
            Fecha < Desde ||
            Fecha > Hasta
          ) {
            return Total;
          }
          const Objetivo_Evento =
            Objetivos_Por_Id[
              Normalizar_Texto(
                Base_Evento.Objetivo_Id
              )
            ];
          if (!Objetivo_Evento) {
            return Total;
          }
          const Coincide =
            Fuente_Tipo === "Categoria"
              ? Normalizar_Texto(
                  Objetivo_Evento.Categoria_Id
                ) === Fuente_Valor
              : Fuente_Tipo === "Etiqueta"
              ? Array.isArray(
                  Objetivo_Evento.Etiquetas_Ids
                ) &&
                Objetivo_Evento.Etiquetas_Ids
                  .map((Id) =>
                    Normalizar_Texto(Id)
                  )
                  .includes(Fuente_Valor)
              : Normalizar_Texto_Busqueda(
                  Objetivo_Evento.Nombre
                ) === Fuente_Clave;
          if (!Coincide) {
            return Total;
          }
          return (
            Total +
            Math.max(
              0,
              Number(Base_Evento.Duracion) || 0
            )
          );
        }, 0);
      const Ratio_Meta =
        Objetivo > 0 ? Progreso / Objetivo : 0;
      const Ratio_Tiempo =
        Calcular_Ratio_Tiempo_Meta_IA(
          Desde,
          Hasta
        );
      let Estado = "En_Ritmo";
      const Hoy = Obtener_Hoy_ISO();
      if (Ratio_Meta >= 1) {
        Estado = "Cumplida";
      } else if (Hoy < Desde) {
        Estado = "Proxima";
      } else if (Hoy > Hasta) {
        Estado = "Vencida";
      } else if (Ratio_Meta - Ratio_Tiempo >= 0.08) {
        Estado = "Adelantada";
      } else if (Ratio_Meta - Ratio_Tiempo <= -0.08) {
        Estado = "Atrasada";
      }
      const Fuente =
        Fuente_Tipo === "Categoria"
          ? Normalizar_Texto(
              Categorias_Por_Id[Fuente_Valor]
                ?.Nombre
            ) || "Categoria eliminada"
          : Fuente_Tipo === "Etiqueta"
          ? Normalizar_Texto(
              Etiquetas_Por_Id[Fuente_Valor]
                ?.Nombre
            ) || "Etiqueta eliminada"
          : Fuente_Valor;
      return {
        Id:
          Normalizar_Texto(Base.Id) ||
          `Meta_${Indice}`,
        Nombre,
        Periodo,
        Unidad: "Horas",
        Objetivo,
        Progreso,
        Estado,
        Fuente,
        Fecha_Desde: Desde,
        Fecha_Hasta: Hasta,
        Archivada: Base.Archivada === true,
        Detalle: null,
      };
    })
    .filter((Meta) => Meta !== null);
}

function Construir_Tareas_Normalizadas_IA(
  Estado: Record<string, unknown>
) {
  return Obtener_Array_Estado(
    Estado,
    "Tareas"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      const Estado_Tarea =
        Normalizar_Texto(
          Base.Estado ||
            Base.estado ||
            "pendiente"
        ) || "pendiente";
      const Pospuesta =
        Estado_Tarea === "pospuesta";
      return {
        Id: Normalizar_Texto(Base.Id),
        Nombre: Normalizar_Texto(
          Base.Nombre || Base.Texto
        ),
        Descripcion: Normalizar_Texto(Base.Descripcion || Base.Nota),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Cajon: Normalizar_Texto(
          Base.Cajon || "Inbox"
        ) || "Inbox",
        Prioridad: Normalizar_Texto(
          Base.Prioridad ||
            Base.prioridad ||
            "baja"
        ) || "baja",
        Estado: Estado_Tarea,
        Fecha: Pospuesta
          ? ""
          : Normalizar_Texto(Base.Fecha),
        Hora: Pospuesta
          ? ""
          : Normalizar_Texto(Base.Hora).slice(
            0,
            5
          ),
        Planeada: Boolean(Base.Planeada),
        Evento_Id: Normalizar_Texto(
          Base.Evento_Id
        ),
        Abordaje_Id: Normalizar_Texto(
          Base.Abordaje_Id
        ),
        Plan_Clave: Normalizar_Texto(
          Base.Plan_Clave
        ),
        Plan_Item_Id: Normalizar_Texto(
          Base.Plan_Item_Id
        ),
        Fecha_Creacion: Normalizar_Texto(
          Base.Fecha_Creacion
        ),
        Fecha_Actualizacion: Normalizar_Texto(
          Base.Fecha_Actualizacion
        ),
        Fecha_Completado: Normalizar_Texto(
          Base.Fecha_Completado
        ),
        Fecha_Limite: Normalizar_Texto(Base.Fecha_Limite),
        Etiquetas: Array.isArray(Base.Etiquetas)
          ? Base.Etiquetas.map((Item) => Normalizar_Texto(Item)).filter(Boolean)
          : [],
        Repeticion: Es_Mapa_B2(Base.Repeticion)
          ? Base.Repeticion : { Tipo: "ninguna" },
        Subtareas: Array.isArray(Base.Subtareas) ? Base.Subtareas : [],
        Adjuntos: Array.isArray(Base.Adjuntos) ? Base.Adjuntos : [],
        Dependencias_Ids: Array.isArray(Base.Dependencias_Ids)
          ? Base.Dependencias_Ids.map((Item) => Normalizar_Texto(Item)).filter(Boolean)
          : [],
        Estimacion_Minutos: Math.max(0, Number(Base.Estimacion_Minutos) || 0),
        Tiempo_Registrado_Minutos: Math.max(0, Number(Base.Tiempo_Registrado_Minutos) || 0),
        Motivo_Posposicion: Normalizar_Texto(Base.Motivo_Posposicion),
        Fecha_Sugerida: Normalizar_Texto(Base.Fecha_Sugerida),
        Archivada: Base.Archivada === true,
        Historial: Array.isArray(Base.Historial) ? Base.Historial : [],
      };
    })
    .filter((Tarea) => Tarea.Nombre);
}

function Construir_Habitos_Normalizados_IA(
  Estado: Record<string, unknown>
) {
  return Obtener_Array_Estado(
    Estado,
    "Habitos"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      const Programacion =
        Base.Programacion &&
          typeof Base.Programacion ===
            "object" &&
          !Array.isArray(Base.Programacion)
          ? Base.Programacion as Record<
            string,
            unknown
          >
          : {};
      const Meta =
        Base.Meta &&
          typeof Base.Meta === "object" &&
          !Array.isArray(Base.Meta)
          ? Base.Meta as Record<
            string,
            unknown
          >
          : {};
      return {
        Id: Normalizar_Texto(Base.Id),
        Nombre: Normalizar_Texto(Base.Nombre),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Tipo: Normalizar_Texto(
          Base.Tipo || "Hacer"
        ) || "Hacer",
        Activo: Base.Activo !== false,
        Archivado: Base.Archivado === true,
        Fecha_Inicio: Normalizar_Texto(
          Base.Fecha_Inicio
        ),
        Programacion: {
          Tipo: Normalizar_Texto(
            Programacion.Tipo || "Libre"
          ) || "Libre",
          Dias: Array.isArray(Programacion.Dias)
            ? Programacion.Dias
              .map((Dia) =>
                Numero_Entero(Dia, -1)
              )
              .filter((Dia) =>
                Dia >= 0 && Dia <= 6
              )
            : [],
          Horas: Array.isArray(
            Programacion.Horas
          )
            ? Programacion.Horas
              .map((Hora) =>
                Number(Hora)
              )
              .filter((Hora) =>
                Number.isFinite(Hora)
              )
            : [],
          Desde: Number(Programacion.Desde) || 0,
          Hasta: Number(Programacion.Hasta) || 0,
        },
        Meta: {
          Modo: Normalizar_Texto(
            Meta.Modo || "Check"
          ) || "Check",
          Regla: Normalizar_Texto(
            Meta.Regla || "Al_Menos"
          ) || "Al_Menos",
          Periodo: Normalizar_Texto(
            Meta.Periodo || "Dia"
          ) || "Dia",
          Cantidad: Number(Meta.Cantidad) || 0,
          Cantidad_Maxima:
            Number(Meta.Cantidad_Maxima) || 0,
          Unidad: Normalizar_Texto(Meta.Unidad),
        },
      };
    })
    .filter((Habito) => Habito.Nombre);
}

function Construir_Registros_Habitos_IA(
  Estado: Record<string, unknown>
) {
  return Obtener_Array_Estado(
    Estado,
    "Habitos_Registros"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Habito_Id: Normalizar_Texto(
          Base.Habito_Id
        ),
        Fecha: Normalizar_Texto(Base.Fecha),
        Hora: Normalizar_Texto(Base.Hora).slice(
          0,
          5
        ),
        Fecha_Hora: Normalizar_Texto(
          Base.Fecha_Hora
        ),
        Periodo_Clave: Normalizar_Texto(
          Base.Periodo_Clave
        ),
        Fuente: Normalizar_Texto(
          Base.Fuente
        ),
        Fuente_Id: Normalizar_Texto(
          Base.Fuente_Id
        ),
        Cantidad: Number(Base.Cantidad) || 0,
        Unidad: Normalizar_Texto(Base.Unidad),
        Nota: Normalizar_Texto(Base.Nota),
        Skip: Base.Skip === true,
      };
    });
}

function Resolver_Modo_Habitos(
  Url: URL
) {
  const Modo = Normalizar_Texto(
    Url.searchParams.get("modo") || "Dia"
  );
  return ["Dia", "Semana", "Quincena", "Mes"]
      .includes(Modo)
    ? Modo
    : "Dia";
}

function Obtener_Lunes_UTC(
  Fecha: Date
) {
  const Dia = Fecha.getUTCDay();
  const Delta = Dia === 0 ? -6 : 1 - Dia;
  return Sumar_Dias(Fecha, Delta);
}

function Resolver_Rango_Habitos(
  Fecha: string,
  Modo: string
) {
  const Base =
    Parsear_Fecha_ISO(Fecha) || new Date();
  if (Modo === "Semana") {
    const Inicio = Obtener_Lunes_UTC(Base);
    return {
      Inicio: Formatear_Fecha_ISO(Inicio),
      Fin: Formatear_Fecha_ISO(
        Sumar_Dias(Inicio, 6)
      ),
    };
  }
  if (Modo === "Quincena") {
    const Lunes = Obtener_Lunes_UTC(Base);
    const Ancla = new Date(
      Date.UTC(1970, 0, 5)
    );
    const Semanas_Desde_Ancla = Math.floor(
      (Lunes.getTime() -
        Ancla.getTime()) /
        86400000 / 7
    );
    const Offset =
      ((Semanas_Desde_Ancla % 2) + 2) % 2;
    const Inicio = Sumar_Dias(
      Lunes,
      -7 * Offset
    );
    return {
      Inicio: Formatear_Fecha_ISO(Inicio),
      Fin: Formatear_Fecha_ISO(
        Sumar_Dias(Inicio, 13)
      ),
    };
  }
  if (Modo === "Mes") {
    const Inicio = new Date(
      Date.UTC(
        Base.getUTCFullYear(),
        Base.getUTCMonth(),
        1
      )
    );
    const Fin = new Date(
      Date.UTC(
        Base.getUTCFullYear(),
        Base.getUTCMonth() + 1,
        0
      )
    );
    return {
      Inicio: Formatear_Fecha_ISO(Inicio),
      Fin: Formatear_Fecha_ISO(Fin),
    };
  }
  return {
    Inicio: Fecha,
    Fin: Fecha,
  };
}

function Habito_Coincide_Con_Dia_IA(
  Habito: Record<string, unknown>,
  Fecha: string
) {
  const Dias = Array.isArray(
    (
      Habito.Programacion as Record<
        string,
        unknown
      >
    )?.Dias
  )
    ? (Habito.Programacion as Record<
      string,
      unknown
    >).Dias as number[]
    : [];
  if (!Dias.length) {
    return true;
  }
  const Fecha_Obj = Parsear_Fecha_ISO(Fecha);
  if (!Fecha_Obj) {
    return false;
  }
  const Dia_JS = Fecha_Obj.getUTCDay();
  const Dia = Dia_JS === 0 ? 6 : Dia_JS - 1;
  return Dias.includes(Dia);
}

function Habito_Fecha_Inicio_Futura_IA(
  Habito: Record<string, unknown>,
  Fecha: string
) {
  const Inicio = Normalizar_Texto(
    Habito.Fecha_Inicio
  );
  return Boolean(Inicio && Inicio > Fecha);
}

function Habito_Periodo_IA(
  Habito: Record<string, unknown>
) {
  const Periodo = Normalizar_Texto(
    (
      Habito.Meta as Record<string, unknown>
    )?.Periodo || "Dia"
  );
  return ["Dia", "Semana", "Quincena", "Mes"]
      .includes(Periodo)
    ? Periodo
    : "Dia";
}

function Habito_Clave_Periodo_IA(
  Habito: Record<string, unknown>,
  Fecha: string
) {
  const Periodo = Habito_Periodo_IA(Habito);
  if (Periodo === "Semana") {
    return Resolver_Rango_Habitos(
      Fecha,
      "Semana"
    ).Inicio;
  }
  const Fecha_Obj = Parsear_Fecha_ISO(Fecha);
  if (!Fecha_Obj) {
    return Fecha;
  }
  if (Periodo === "Quincena") {
    return `Q2S-${Resolver_Rango_Habitos(
      Fecha,
      "Quincena"
    ).Inicio}`;
  }
  if (Periodo === "Mes") {
    return `${Fecha_Obj.getUTCFullYear()}-${String(
      Fecha_Obj.getUTCMonth() + 1
    ).padStart(2, "0")}`;
  }
  return Fecha;
}

function Habito_Regla_IA(
  Habito: Record<string, unknown>
) {
  const Regla = Normalizar_Texto(
    (
      Habito.Meta as Record<string, unknown>
    )?.Regla || "Al_Menos"
  );
  return [
    "Al_Menos",
    "Exactamente",
    "Como_Maximo",
    "Entre",
  ].includes(Regla)
    ? Regla
    : "Al_Menos";
}

function Habito_Objetivo_IA(
  Habito: Record<string, unknown>
) {
  const Cantidad = Number(
    (
      Habito.Meta as Record<string, unknown>
    )?.Cantidad
  );
  if (Number.isFinite(Cantidad)) {
    return Cantidad;
  }
  return Habito.Tipo === "Evitar" ? 0 : 1;
}

function Habito_Modo_IA(
  Habito: Record<string, unknown>
) {
  return Normalizar_Texto(
    (
      Habito.Meta as Record<string, unknown>
    )?.Modo || "Check"
  ) || "Check";
}

function Habito_Cancelado_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Registros: Record<string, unknown>[]
) {
  const Periodo_Clave =
    Habito_Clave_Periodo_IA(Habito, Fecha);
  return Registros.some((Registro) =>
    Registro.Habito_Id === Habito.Id &&
    Registro.Periodo_Clave === Periodo_Clave &&
    Registro.Skip === true
  );
}

function Habito_Evitar_Confirmado_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Registros: Record<string, unknown>[]
) {
  if (Habito.Tipo !== "Evitar") {
    return false;
  }
  const Periodo_Clave =
    Habito_Clave_Periodo_IA(Habito, Fecha);
  return Registros.some((Registro) =>
    Registro.Habito_Id === Habito.Id &&
    Registro.Periodo_Clave === Periodo_Clave &&
    Registro.Fuente === "Manual" &&
    Registro.Skip !== true
  );
}

function Habito_Progreso_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Registros: Record<string, unknown>[]
) {
  const Periodo_Clave =
    Habito_Clave_Periodo_IA(Habito, Fecha);
  return Registros
    .filter((Registro) =>
      Registro.Habito_Id === Habito.Id &&
      Registro.Periodo_Clave === Periodo_Clave &&
      Registro.Skip !== true
    )
    .reduce(
      (Total, Registro) =>
        Total + (Number(Registro.Cantidad) || 0),
      0
    );
}

function Habito_Periodo_Finalizado_IA(
  Habito: Record<string, unknown>,
  Fecha: string
) {
  const Rango = Resolver_Rango_Habitos(
    Fecha,
    Habito_Periodo_IA(Habito)
  );
  const Fin = Parsear_Fecha_ISO(Rango.Fin);
  const Hoy = Parsear_Fecha_ISO(
    Obtener_Hoy_ISO()
  );
  return Boolean(
    Fin && Hoy && Fin.getTime() < Hoy.getTime()
  );
}

function Habito_Esta_Completo_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Registros: Record<string, unknown>[]
) {
  const Actual = Habito_Progreso_IA(
    Habito,
    Fecha,
    Registros
  );
  const Objetivo = Habito_Objetivo_IA(
    Habito
  );
  const Regla = Habito_Regla_IA(Habito);
  if (Habito.Tipo === "Evitar") {
    return Actual <= Objetivo &&
      Habito_Evitar_Confirmado_IA(
        Habito,
        Fecha,
        Registros
      );
  }
  if (Regla === "Como_Maximo") {
    if (Habito_Modo_IA(Habito) === "Tiempo") {
      return Habito_Periodo_Finalizado_IA(
        Habito,
        Fecha
      ) && Actual <= Objetivo;
    }
    return Actual <= Objetivo;
  }
  if (Regla === "Entre") {
    const Maximo = Number(
      (
        Habito.Meta as Record<string, unknown>
      )?.Cantidad_Maxima
    ) || Objetivo;
    return Actual >= Objetivo &&
      Actual <= Maximo;
  }
  if (Regla === "Exactamente") {
    return Math.abs(Actual - Objetivo) < 0.0001;
  }
  return Actual >= Objetivo;
}

function Habito_Estado_Visible_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Registros: Record<string, unknown>[]
) {
  if (Habito.Archivado === true) {
    return "Inactivo";
  }
  if (
    Habito_Fecha_Inicio_Futura_IA(
      Habito,
      Fecha
    )
  ) {
    return "Inactivo";
  }
  if (
    Habito_Cancelado_IA(
      Habito,
      Fecha,
      Registros
    )
  ) {
    return "Cancelado";
  }
  if (Habito.Activo === false) {
    return "Inactivo";
  }
  const Actual = Habito_Progreso_IA(
    Habito,
    Fecha,
    Registros
  );
  const Regla = Habito_Regla_IA(Habito);
  const Objetivo = Habito_Objetivo_IA(
    Habito
  );
  if (Regla === "Como_Maximo") {
    if (Actual > Objetivo) {
      return "Pendiente";
    }
    if (
      Habito_Modo_IA(Habito) === "Tiempo" &&
      Habito_Periodo_Finalizado_IA(
        Habito,
        Fecha
      )
    ) {
      return "Realizado";
    }
    if (
      Habito.Tipo === "Evitar" &&
      Habito_Evitar_Confirmado_IA(
        Habito,
        Fecha,
        Registros
      )
    ) {
      return "Realizado";
    }
    return Actual > 0
      ? "En_Proceso"
      : "Pendiente";
  }
  if (Actual <= 0) {
    return "Pendiente";
  }
  return Habito_Esta_Completo_IA(
      Habito,
      Fecha,
      Registros
    )
    ? "Realizado"
    : "En_Proceso";
}

function Habito_Pasa_Contexto_IA(
  Habito: Record<string, unknown>,
  Fecha: string,
  Modo: string
) {
  const Periodo = Habito_Periodo_IA(
    Habito
  );
  if (Modo === "Dia") {
    return Periodo === "Dia" &&
      Habito_Coincide_Con_Dia_IA(
        Habito,
        Fecha
      );
  }
  if (Modo === "Semana") {
    return Periodo === "Semana";
  }
  if (Modo === "Quincena") {
    return Periodo === "Quincena";
  }
  if (Modo === "Mes") {
    return Periodo === "Mes";
  }
  return true;
}

function Construir_Slots_Normalizados_IA(
  Estado: Record<string, unknown>,
  Desde: string,
  Hasta: string
) {
  const Config_Extra =
    Obtener_Objeto_Estado(
      Estado,
      "Config_Extra"
    );
  const Tipos_Slot = Obtener_Array_Estado(
    Estado,
    "Tipos_Slot"
  );
  const Planes_Slot = Obtener_Objeto_Estado(
    Estado,
    "Planes_Slot"
  );
  const Slots_Muertos = new Set(
    Obtener_Array_Estado(
      Estado,
      "Slots_Muertos"
    )
      .map((Item) => {
        if (typeof Item === "string") {
          return Item;
        }
        const Base =
          Item as Record<string, unknown>;
        return (
          Normalizar_Texto(Base?.Clave) ||
          `${Normalizar_Texto(Base?.Fecha)}|${Numero_Entero(
            Base?.Hora,
            -1
          )}`
        );
      })
      .filter(Boolean)
  );
  const Slots_Muertos_Tipos =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Tipos"
    );
  const Slots_Muertos_Nombres =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Nombres"
    );
  const Slots_Muertos_Titulos_Visibles =
    Obtener_Objeto_Estado(
      Estado,
      "Slots_Muertos_Titulos_Visibles"
    );
  const Tipos_Slot_Por_Id =
    Construir_Mapa_Por_Id(Tipos_Slot);
  const Inicio_Hora = Math.max(
    0,
    Math.min(
      23,
      Numero_Entero(
        Config_Extra.Inicio_Hora,
        0
      )
    )
  );
  const Fin_Hora = Math.max(
    Inicio_Hora + 1,
    Math.min(
      24,
      Numero_Entero(Config_Extra.Fin_Hora, 24)
    )
  );
  const Ocupadas = new Set(
    Construir_Bloques_Agenda(
      Estado,
      Desde,
      Hasta
    )
      .filter((Bloque) => Bloque.Tipo === "Evento")
      .flatMap((Bloque) => {
        const Inicio = Numero_Entero(
          String(Bloque.Inicio).slice(0, 2),
          -1
        );
        const Fin = Numero_Entero(
          String(Bloque.Fin).slice(0, 2),
          -1
        );
        const Claves: string[] = [];
        for (
          let Hora = Inicio;
          Hora >= 0 && Hora < Fin;
          Hora += 1
        ) {
          Claves.push(
            `${Normalizar_Texto(
              Bloque.Fecha
            )}|${Hora}`
          );
        }
        return Claves;
      })
  );
  const Resultado: Record<string, unknown>[] =
    [];
  let Fecha_Actual = Desde;
  while (Fecha_Actual <= Hasta) {
    for (
      let Hora = Inicio_Hora;
      Hora < Fin_Hora;
      Hora += 1
    ) {
      const Clave = `${Fecha_Actual}|${Hora}`;
      if (Ocupadas.has(Clave)) {
        continue;
      }
      const Tipo_Id = Normalizar_Texto(
        Slots_Muertos_Tipos[Clave]
      );
      const Tipo =
        Tipos_Slot_Por_Id[Tipo_Id] || null;
      const Nombre = Normalizar_Texto(
        Slots_Muertos_Nombres[Clave]
      );
      const Plan =
        Normalizar_Plan_Slot_IA(
          Planes_Slot[Clave]
        );
      Resultado.push({
        Fecha: Fecha_Actual,
        Hora: Formatear_Hora(Hora),
        Tipo: Slots_Muertos.has(Clave)
          ? "Slot_Muerto"
          : "Slot_Vacio",
        Es_Slot_Muerto:
          Slots_Muertos.has(Clave),
        Tipo_Id: Tipo_Id || null,
        Tipo_Nombre: Normalizar_Texto(
          Tipo?.Nombre
        ),
        Titulo_Visible: Boolean(
          Slots_Muertos_Titulos_Visibles[Clave]
        )
          ? Nombre
          : "",
        Nombre_Slot: Nombre,
        Plan,
      });
    }
    Fecha_Actual = Formatear_Fecha_ISO(
      Sumar_Dias(
        Parsear_Fecha_ISO(Fecha_Actual)!,
        1
      )
    );
  }
  return Resultado;
}

function Construir_Eventos_Semana_IA(
  Estado: Record<string, unknown>,
  Semana: string
) {
  const Desde = Semana;
  const Hasta = Formatear_Fecha_ISO(
    Sumar_Dias(Parsear_Fecha_ISO(Semana)!, 6)
  );
  return Obtener_Array_Estado(
    Estado,
    "Eventos"
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Objetivo_Id: Normalizar_Texto(
          Base.Objetivo_Id
        ),
        Fecha: Normalizar_Texto(Base.Fecha),
        Inicio: Numero_Entero(Base.Inicio, 0),
        Duracion: Math.max(
          1,
          Numero_Entero(Base.Duracion, 1)
        ),
        Color: Normalizar_Texto(Base.Color) || null,
      };
    })
    .filter((Evento) =>
      Evento.Id &&
      Evento.Fecha >= Desde &&
      Evento.Fecha <= Hasta
    );
}

function Construir_Clave_Evento_Plan_IA(
  Evento: Record<string, unknown>
) {
  return Normalizar_Texto(Evento.Id);
}

function Construir_Diff_Plan_Semana_IA(
  Eventos_Base: Record<string, unknown>[],
  Eventos_Actuales: Record<string, unknown>[]
) {
  const Mapa_Base = new Map(
    Eventos_Base.map((Evento) => [
      Construir_Clave_Evento_Plan_IA(Evento),
      Evento,
    ])
  );
  const Mapa_Actual = new Map(
    Eventos_Actuales.map((Evento) => [
      Construir_Clave_Evento_Plan_IA(Evento),
      Evento,
    ])
  );
  const Agregados: Record<string, unknown>[] = [];
  const Quitados: Record<string, unknown>[] = [];
  const Movidos: Record<string, unknown>[] = [];
  const Duracion: Record<string, unknown>[] = [];

  Eventos_Actuales.forEach((Evento) => {
    const Antes = Mapa_Base.get(
      Construir_Clave_Evento_Plan_IA(Evento)
    );
    if (!Antes) {
      Agregados.push(Evento);
      return;
    }
    if (
      Normalizar_Texto(Antes.Fecha) !==
        Normalizar_Texto(Evento.Fecha) ||
      Numero_Entero(Antes.Inicio, 0) !==
        Numero_Entero(Evento.Inicio, 0)
    ) {
      Movidos.push({
        Id: Evento.Id,
        Antes: {
          Fecha: Antes.Fecha,
          Inicio: Antes.Inicio,
        },
        Ahora: {
          Fecha: Evento.Fecha,
          Inicio: Evento.Inicio,
        },
      });
    }
    if (
      Numero_Entero(Antes.Duracion, 1) !==
      Numero_Entero(Evento.Duracion, 1)
    ) {
      Duracion.push({
        Id: Evento.Id,
        Antes: Numero_Entero(Antes.Duracion, 1),
        Ahora: Numero_Entero(Evento.Duracion, 1),
      });
    }
  });

  Eventos_Base.forEach((Evento) => {
    const Clave =
      Construir_Clave_Evento_Plan_IA(Evento);
    if (!Mapa_Actual.has(Clave)) {
      Quitados.push(Evento);
    }
  });

  return {
    Agregados,
    Quitados,
    Movidos,
    Duracion,
    Resumen: {
      Agregados: Agregados.length,
      Quitados: Quitados.length,
      Movidos: Movidos.length,
      Duracion: Duracion.length,
    },
  };
}

function Construir_Plan_Semana_Normalizado_IA(
  Estado: Record<string, unknown>,
  Semana: string
) {
  const Planes_Semana =
    Obtener_Objeto_Estado(
      Estado,
      "Planes_Semana"
    );
  const Plan_Raw = Planes_Semana[Semana];
  const Plan =
    Plan_Raw &&
      typeof Plan_Raw === "object" &&
      !Array.isArray(Plan_Raw)
      ? Plan_Raw as Record<string, unknown>
      : {};
  const Eventos_Base = Array.isArray(
    Plan.Eventos_Base
  )
    ? Plan.Eventos_Base
      .filter((Item) =>
        Item && typeof Item === "object"
      )
      .map((Item) => {
        const Base =
          Item as Record<string, unknown>;
        return {
          Id: Normalizar_Texto(Base.Id),
          Objetivo_Id: Normalizar_Texto(
            Base.Objetivo_Id
          ),
          Fecha: Normalizar_Texto(Base.Fecha),
          Inicio: Numero_Entero(Base.Inicio, 0),
          Duracion: Math.max(
            1,
            Numero_Entero(Base.Duracion, 1)
          ),
          Color:
            Normalizar_Texto(Base.Color) || null,
        };
      })
    : [];
  const Eventos_Actuales =
    Construir_Eventos_Semana_IA(
      Estado,
      Semana
    );
  const Diff = Construir_Diff_Plan_Semana_IA(
    Eventos_Base,
    Eventos_Actuales
  );

  return {
    Semana,
    Fijada_En: Normalizar_Texto(
      Plan.Fijada_En
    ) || null,
    Cerrada_En: Normalizar_Texto(
      Plan.Cerrada_En
    ) || null,
    Nota_Inicial: Normalizar_Texto(
      Plan.Nota_Inicial
    ),
    Nota_Cierre: Normalizar_Texto(
      Plan.Nota_Cierre
    ),
    Veces_Refijada: Math.max(
      0,
      Numero_Entero(Plan.Veces_Refijada, 0)
    ),
    Eventos_Base,
    Eventos_Actuales,
    Diff,
  };
}

function Copiar_Objeto_IA(Valor: unknown): Mapa {
  if (
    !Valor ||
    typeof Valor !== "object" ||
    Array.isArray(Valor)
  ) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(Valor)) as Mapa;
  } catch (_) {
    return {};
  }
}

function Resolver_Modelo_Planes_Periodo_IA(
  Estado: Record<string, unknown>
) {
  const Raw = Obtener_Objeto_Estado(
    Estado,
    "Planes_Periodo"
  );
  const Usa_V2 = Numero_Entero(Raw.Version, 0) === 2;
  const Periodos_Raw = Usa_V2
    ? Obtener_Objeto_Estado(Raw, "Periodos")
    : Raw;
  const Objetivos_Raw =
    Obtener_Objeto_Estado(Raw, "Objetivos");
  const Subobjetivos_Raw =
    Obtener_Objeto_Estado(
      Raw,
      "Subobjetivos"
    );
  const Partes_Raw =
    Obtener_Objeto_Estado(Raw, "Partes");
  const Avances_Raw =
    Obtener_Objeto_Estado(Raw, "Avances");

  const Periodos = Object.values(Periodos_Raw)
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      const Inicio = Normalizar_Texto(
        Base.Inicio
      );
      const Fin = Normalizar_Texto(
        Base.Fin || Base.Inicio
      );
      const Tipo = Normalizar_Texto(
        Base.Tipo || "Custom"
      ) || "Custom";
      const Id =
        Normalizar_Texto(Base.Id) ||
        `P_${Tipo}_${Inicio}_${Fin}`;
      return {
        Id,
        Tipo,
        Inicio,
        Fin,
        Titulo: Normalizar_Texto(
          Base.Titulo
        ),
        Resumen: Normalizar_Texto(
          Base.Resumen || Base.Nota
        ),
        Parent_Id: Normalizar_Texto(
          Base.Parent_Id
        ) || null,
        Tags: Array.isArray(Base.Tags)
          ? Base.Tags
            .map((Tag) =>
              Normalizar_Texto(Tag)
            )
            .filter(Boolean)
          : [],
        Estado: Normalizar_Texto(
          Base.Estado || "Activo"
        ) || "Activo",
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
        Creado_En: Normalizar_Texto(
          Base.Creado_En
        ),
        Actualizado_En: Normalizar_Texto(
          Base.Actualizado_En
        ),
      };
    })
    .filter((Periodo) =>
      Periodo.Id && Periodo.Inicio && Periodo.Fin
    );

  const Objetivos = Object.values(Objetivos_Raw)
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Periodo_Id: Normalizar_Texto(
          Base.Periodo_Id
        ) || null,
        Objetivo_Padre_Id: Normalizar_Texto(
          Base.Objetivo_Padre_Id ||
            Base.Parent_Objetivo_Id
        ) || null,
        Nombre: Normalizar_Texto(Base.Nombre),
        Descripcion: Normalizar_Texto(
          Base.Descripcion || Base.Resumen
        ),
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2705"
        ),
        Color: Normalizar_Texto(Base.Color),
        Target_Total:
          Number(Base.Target_Total) || 0,
        Progreso_Total:
          Number(Base.Progreso_Total) || 0,
        Target_Pendiente:
          Number(Base.Target_Pendiente) || 0,
        Unidad: Normalizar_Texto(
          Base.Unidad || "Horas"
        ) || "Horas",
        Unidad_Custom: Normalizar_Texto(
          Base.Unidad_Custom ||
            Base.Unidad_Personalizada
        ),
        Tiempo_Valor:
          Number(Base.Tiempo_Valor) || 0,
        Tiempo_Modo: Normalizar_Texto(
          Base.Tiempo_Modo
        ),
        Modo_Avance: Normalizar_Texto(
          Base.Modo_Avance
        ),
        Estado: Normalizar_Texto(
          Base.Estado || "Activo"
        ) || "Activo",
        Fecha_Inicio: Normalizar_Texto(
          Base.Fecha_Inicio
        ),
        Fecha_Objetivo: Normalizar_Texto(
          Base.Fecha_Objetivo
        ),
        Fecha_Fin: Normalizar_Texto(
          Base.Fecha_Fin
        ),
        Hora_Fin: Normalizar_Texto(
          Base.Hora_Fin
        ),
        Etiquetas_Ids: Array.isArray(
          Base.Etiquetas_Ids
        )
          ? Base.Etiquetas_Ids
            .map((Id) =>
              Normalizar_Texto(Id)
            )
            .filter(Boolean)
          : [],
        Tags: Array.isArray(Base.Tags)
          ? Base.Tags
            .map((Tag) =>
              Normalizar_Texto(Tag)
            )
            .filter(Boolean)
          : [],
        Metadatos_Campos: Array.isArray(
          Base.Metadatos_Campos
        )
          ? Base.Metadatos_Campos
          : [],
        Metadatos_Campos_Config:
          Base.Metadatos_Campos_Config === true,
        Ajustes_Periodos: Copiar_Objeto_IA(
          Base.Ajustes_Periodos ||
            Base.Ajustes_Periodo ||
            Base.Targets_Periodos
        ),
        Redistribucion_Target: Copiar_Objeto_IA(
          Base.Redistribucion_Target ||
            Base.Redistribucion_Objetivo ||
            Base.Redistribucion
        ),
        Oculto_Periodos: Copiar_Objeto_IA(
          Base.Oculto_Periodos ||
            Base.Periodos_Ocultos ||
            Base.Ocultamientos_Periodo
        ),
        Modo_Progreso: Normalizar_Texto(
          Base.Modo_Progreso || "Hibrido"
        ),
        Target_Actual:
          Number(Base.Target_Actual) ||
          Number(Base.Target_Total) || 0,
        Target_Automatico:
          Number(Base.Target_Automatico) ||
          Number(Base.Target_Total) || 0,
        Target_Fijado:
          Number(Base.Target_Fijado) || 0,
        Progreso_Manual:
          Number(Base.Progreso_Manual) || 0,
        Progreso_Importado:
          Number(Base.Progreso_Importado) || 0,
        Progreso_Leido:
          Number(Base.Progreso_Leido) || 0,
        Progreso_Subobjetivos:
          Number(Base.Progreso_Subobjetivos) || 0,
        Fijado: Base.Fijado === true,
        Pausado: Base.Pausado === true,
        Eliminado_Local: Base.Eliminado_Local === true,
        Vinculo_Sidebar_Activo:
          Base.Vinculo_Sidebar_Activo !== false,
        Vinculo_Tipo: Normalizar_Texto(
          Base.Vinculo_Tipo
        ),
        Vinculo_Id: Normalizar_Texto(Base.Vinculo_Id),
        Vinculo_Objetivo_Id: Normalizar_Texto(
          Base.Vinculo_Objetivo_Id
        ),
        Vinculo_Subobjetivo_Id: Normalizar_Texto(
          Base.Vinculo_Subobjetivo_Id
        ),
        Vinculo_Texto: Normalizar_Texto(
          Base.Vinculo_Texto
        ),
        Warnings: Array.isArray(Base.Warnings)
          ? Base.Warnings
            .map((Warning) => Normalizar_Texto(Warning))
            .filter(Boolean)
          : [],
        Habitos_Vinculos: Array.isArray(
          Base.Habitos_Vinculos
        )
          ? Base.Habitos_Vinculos
          : [],
        Habitos_Vinculos_Hijos_Default: Array.isArray(
          Base.Habitos_Vinculos_Hijos_Default
        )
          ? Base.Habitos_Vinculos_Hijos_Default
          : [],
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
        Creado_En: Normalizar_Texto(
          Base.Creado_En
        ),
        Actualizado_En: Normalizar_Texto(
          Base.Actualizado_En
        ),
      };
    })
    .filter((Objetivo) =>
      Objetivo.Id && Objetivo.Nombre
    );

  const Subobjetivos = Object.values(
    Subobjetivos_Raw
  )
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Objetivo_Id: Normalizar_Texto(
          Base.Objetivo_Id
        ) || null,
        Parent_Subobjetivo_Id:
          Normalizar_Texto(
            Base.Parent_Subobjetivo_Id
          ) || null,
        Subobjetivo_Padre_Id:
          Normalizar_Texto(
            Base.Subobjetivo_Padre_Id
          ) || null,
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Texto: Normalizar_Texto(
          Base.Texto
        ),
        Target_Total:
          Number(Base.Target_Total) || 0,
        Aporte_Meta:
          Number(Base.Aporte_Meta) || 0,
        Unidad: Normalizar_Texto(
          Base.Unidad
        ),
        Unidad_Custom: Normalizar_Texto(
          Base.Unidad_Custom ||
            Base.Unidad_Personalizada
        ),
        Tiempo_Valor:
          Number(Base.Tiempo_Valor) || 0,
        Tiempo_Modo: Normalizar_Texto(
          Base.Tiempo_Modo
        ),
        Progreso_Manual:
          Number(Base.Progreso_Manual) || 0,
        Progreso_Avances:
          Number(Base.Progreso_Avances) || 0,
        Fecha_Inicio: Normalizar_Texto(
          Base.Fecha_Inicio
        ),
        Fecha_Objetivo: Normalizar_Texto(
          Base.Fecha_Objetivo
        ),
        Fecha_Fin: Normalizar_Texto(
          Base.Fecha_Fin
        ),
        Hora_Fin: Normalizar_Texto(
          Base.Hora_Fin
        ),
        Estado: Normalizar_Texto(
          Base.Estado || "Activo"
        ) || "Activo",
        Hecha: Base.Hecha === true,
        Importado: Base.Importado === true,
        Metadatos: Copiar_Objeto_IA(Base.Metadatos),
        Habitos_Vinculos: Array.isArray(
          Base.Habitos_Vinculos
        )
          ? Base.Habitos_Vinculos
          : [],
        Habitos_Vinculos_Hijos_Default: Array.isArray(
          Base.Habitos_Vinculos_Hijos_Default
        )
          ? Base.Habitos_Vinculos_Hijos_Default
          : [],
        Eliminado_Local: Base.Eliminado_Local === true,
        Creado_En: Normalizar_Texto(Base.Creado_En),
        Actualizado_En: Normalizar_Texto(
          Base.Actualizado_En
        ),
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
      };
    })
    .filter((Sub) =>
      Sub.Id && Sub.Objetivo_Id && Sub.Texto
    );

  const Partes = Object.values(Partes_Raw)
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Objetivo_Id: Normalizar_Texto(
          Base.Objetivo_Id
        ) || null,
        Subobjetivo_Id:
          Normalizar_Texto(
            Base.Subobjetivo_Id ||
              Base.Sub_Id
          ) || null,
        Emoji: Normalizar_Texto(
          Base.Emoji || "\u2022"
        ),
        Nombre: Normalizar_Texto(
          Base.Nombre || Base.Texto
        ),
        Aporte_Total:
          Number(Base.Aporte_Total ??
            Base.Target_Total) || 0,
        Unidad: Normalizar_Texto(Base.Unidad),
        Unidad_Custom: Normalizar_Texto(
          Base.Unidad_Custom ||
            Base.Unidad_Personalizada
        ),
        Tiempo_Valor:
          Number(Base.Tiempo_Valor) || 0,
        Tiempo_Modo: Normalizar_Texto(
          Base.Tiempo_Modo
        ),
        Progreso_Avances:
          Number(Base.Progreso_Avances) || 0,
        Progreso_Total:
          Number(Base.Progreso_Total) || 0,
        Fecha_Inicio: Normalizar_Texto(
          Base.Fecha_Inicio
        ),
        Fecha_Objetivo: Normalizar_Texto(
          Base.Fecha_Objetivo
        ),
        Fecha_Fin: Normalizar_Texto(
          Base.Fecha_Fin
        ),
        Hora_Fin: Normalizar_Texto(
          Base.Hora_Fin
        ),
        Estado: Normalizar_Texto(
          Base.Estado || "Pendiente"
        ) || "Pendiente",
        Metadatos: Copiar_Objeto_IA(Base.Metadatos),
        Habitos_Vinculos: Array.isArray(
          Base.Habitos_Vinculos
        )
          ? Base.Habitos_Vinculos
          : [],
        Eliminado_Local: Base.Eliminado_Local === true,
        Creado_En: Normalizar_Texto(Base.Creado_En),
        Actualizado_En: Normalizar_Texto(
          Base.Actualizado_En
        ),
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
      };
    })
    .filter((Parte) =>
      Parte.Id && Parte.Subobjetivo_Id && Parte.Nombre
    );

  const Avances = Object.values(Avances_Raw)
    .filter((Item) =>
      Item && typeof Item === "object"
    )
    .map((Item, Indice) => {
      const Base =
        Item as Record<string, unknown>;
      return {
        Id: Normalizar_Texto(Base.Id),
        Objetivo_Id: Normalizar_Texto(
          Base.Objetivo_Id
        ) || null,
        Subobjetivo_Id:
          Normalizar_Texto(
            Base.Subobjetivo_Id
          ) || null,
        Parte_Id: Normalizar_Texto(
          Base.Parte_Id
        ) || null,
        Fuente: Normalizar_Texto(
          Base.Fuente || "Manual"
        ) || "Manual",
        Modo: Normalizar_Texto(Base.Modo || "Cantidad"),
        Cantidad: Number(Base.Cantidad) || 0,
        Cantidad_Total:
          Number(Base.Cantidad_Total) || 0,
        Base: Number(Base.Base) || 0,
        Hasta: Number(Base.Hasta) || 0,
        Unidad: Normalizar_Texto(Base.Unidad),
        Fecha: Normalizar_Texto(Base.Fecha),
        Hora: Normalizar_Texto(Base.Hora),
        Fecha_Hora: Normalizar_Texto(
          Base.Fecha_Hora
        ),
        Nota: Normalizar_Texto(Base.Nota),
        Origen_Tipo: Normalizar_Texto(
          Base.Origen_Tipo
        ),
        Origen_Id: Normalizar_Texto(
          Base.Origen_Id
        ),
        Origen_Objetivo_Semanal_Id: Normalizar_Texto(
          Base.Origen_Objetivo_Semanal_Id
        ),
        Origen_Subobjetivo_Semanal_Id: Normalizar_Texto(
          Base.Origen_Subobjetivo_Semanal_Id
        ),
        Automatico: Base.Automatico === true,
        Metadatos: Copiar_Objeto_IA(Base.Metadatos),
        Distribucion: Array.isArray(
          Base.Distribucion
        )
          ? Base.Distribucion
            .filter((D) =>
              D && typeof D === "object"
            )
            .map((D) => ({
              Tipo: Normalizar_Texto(
                (D as Record<string, unknown>).Tipo
              ),
              Parte_Id: Normalizar_Texto(
                (D as Record<string, unknown>).Parte_Id
              ),
              Cantidad:
                Number(
                  (D as Record<string, unknown>).Cantidad
                ) || 0,
            }))
          : [],
        Orden: Number.isFinite(Number(Base.Orden))
          ? Number(Base.Orden)
          : Indice,
        Creado_En: Normalizar_Texto(
          Base.Creado_En
        ),
        Actualizado_En: Normalizar_Texto(
          Base.Actualizado_En
        ),
      };
    })
    .filter((Avance) =>
      Avance.Id && (Avance.Objetivo_Id ||
      Avance.Subobjetivo_Id || Avance.Parte_Id)
    );

  return {
    Periodos,
    Objetivos,
    Subobjetivos,
    Partes,
    Avances,
  };
}

function Construir_Resumen_Modelo_Planes_IA(
  Modelo: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >
) {
  return {
    Periodos_Total: Modelo.Periodos.length,
    Objetivos_Total: Modelo.Objetivos.length,
    Subobjetivos_Total:
      Modelo.Subobjetivos.length,
    Partes_Total: Modelo.Partes.length,
    Avances_Total: Modelo.Avances.length,
  };
}

function Construir_Ids_Periodos_Relevantes_IA(
  Periodo_Id: string,
  Periodos: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >["Periodos"]
) {
  const Hijos_Por_Padre = new Map<
    string,
    string[]
  >();
  Periodos.forEach((Periodo) => {
    if (!Periodo.Parent_Id) {
      return;
    }
    if (!Hijos_Por_Padre.has(Periodo.Parent_Id)) {
      Hijos_Por_Padre.set(Periodo.Parent_Id, []);
    }
    Hijos_Por_Padre.get(Periodo.Parent_Id)!.push(
      Periodo.Id
    );
  });
  const Resultado = new Set<string>();
  const Cola = [Periodo_Id];
  while (Cola.length) {
    const Actual = Cola.shift()!;
    if (Resultado.has(Actual)) {
      continue;
    }
    Resultado.add(Actual);
    (Hijos_Por_Padre.get(Actual) || [])
      .forEach((Hijo) => Cola.push(Hijo));
  }
  return Resultado;
}

function Porcentaje_Planes_IA(
  Progreso: number,
  Target: number
) {
  if (Target <= 0) return null;
  return Math.round((Progreso / Target) * 10000) / 100;
}

function Construir_Arbol_Planes_IA(
  Objetivos: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >["Objetivos"],
  Subobjetivos: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >["Subobjetivos"],
  Partes: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >["Partes"],
  Avances: ReturnType<
    typeof Resolver_Modelo_Planes_Periodo_IA
  >["Avances"]
) {
  const Objetivos_Ids = new Set(
    Objetivos.map((Objetivo) => Objetivo.Id)
  );
  const Ordenar = <T extends { Orden: number }>(
    Items: T[]
  ) => Items.slice().sort((A, B) => A.Orden - B.Orden);
  const Familia_Subobjetivo = (Subobjetivo_Id: string) => {
    const Ids = new Set([Subobjetivo_Id]);
    let Cambio = true;
    while (Cambio) {
      Cambio = false;
      Subobjetivos.forEach((Subobjetivo) => {
        const Padre =
          Subobjetivo.Subobjetivo_Padre_Id ||
          Subobjetivo.Parent_Subobjetivo_Id || "";
        if (!Ids.has(Padre) || Ids.has(Subobjetivo.Id)) {
          return;
        }
        Ids.add(Subobjetivo.Id);
        Cambio = true;
      });
    }
    return Ids;
  };
  const Avances_De = (Filtros: {
    Objetivo_Id?: string;
    Subobjetivo_Id?: string;
    Parte_Id?: string;
  }) => Avances.filter((Avance) => {
    if (
      Filtros.Parte_Id &&
      Avance.Parte_Id === Filtros.Parte_Id
    ) {
      return true;
    }
    if (
      Filtros.Subobjetivo_Id &&
      Avance.Subobjetivo_Id === Filtros.Subobjetivo_Id &&
      !Avance.Parte_Id
    ) {
      return true;
    }
    return Boolean(
      Filtros.Objetivo_Id &&
        Avance.Objetivo_Id === Filtros.Objetivo_Id &&
        !Avance.Subobjetivo_Id &&
        !Avance.Parte_Id
    );
  });
  const Estadisticas = (
    Target: number,
    Progreso: number,
    Registros: typeof Avances,
    Hijos: {
      Subobjetivos?: number;
      Partes?: number;
    } = {}
  ) => ({
    Target,
    Progreso,
    Pendiente: Math.max(0, Target - Progreso),
    Porcentaje: Porcentaje_Planes_IA(Progreso, Target),
    Registros_Total: Registros.length,
    Avance_Registrado: Registros.reduce(
      (Total, Avance) => Total + Avance.Cantidad,
      0
    ),
    Subobjetivos_Total: Hijos.Subobjetivos || 0,
    Partes_Total: Hijos.Partes || 0,
  });
  const Construir_Parte = (Parte: typeof Partes[number]) => {
    const Registros = Avances_De({ Parte_Id: Parte.Id });
    return {
      ...Parte,
      Estadisticas: Estadisticas(
        Parte.Aporte_Total,
        Parte.Progreso_Total,
        Registros
      ),
      Avances: Registros,
    };
  };
  const Construir_Subobjetivo = (
    Subobjetivo: typeof Subobjetivos[number]
  ): Mapa => {
    const Hijos = Ordenar(Subobjetivos.filter((Item) =>
      Item.Subobjetivo_Padre_Id === Subobjetivo.Id ||
      Item.Parent_Subobjetivo_Id === Subobjetivo.Id
    )).map(Construir_Subobjetivo);
    const Partes_Directas = Ordenar(Partes.filter((Parte) =>
      Parte.Subobjetivo_Id === Subobjetivo.Id
    )).map(Construir_Parte);
    const Familia_Ids = Familia_Subobjetivo(Subobjetivo.Id);
    const Partes_Familia = Partes.filter((Parte) =>
      Familia_Ids.has(Parte.Subobjetivo_Id || "")
    );
    const Registros = Avances.filter((Avance) =>
      Avance.Subobjetivo_Id === Subobjetivo.Id ||
      Partes_Familia.some((Parte) => Parte.Id === Avance.Parte_Id)
    );
    return {
      ...Subobjetivo,
      Estadisticas: Estadisticas(
        Subobjetivo.Target_Total,
        Math.max(
          Subobjetivo.Progreso_Manual,
          Subobjetivo.Progreso_Avances
        ),
        Registros,
        {
          Subobjetivos: Hijos.length,
          Partes: Partes_Directas.length,
        }
      ),
      Subobjetivos_Hijos: Hijos,
      Partes: Partes_Directas,
      Avances: Avances_De({
        Subobjetivo_Id: Subobjetivo.Id,
      }),
    };
  };
  const Construir_Objetivo = (
    Objetivo: typeof Objetivos[number]
  ): Mapa => {
    const Hijos = Ordenar(Objetivos.filter((Item) =>
      Item.Objetivo_Padre_Id === Objetivo.Id
    )).map(Construir_Objetivo);
    const Subobjetivos_Raiz = Ordenar(Subobjetivos.filter((Sub) =>
      Sub.Objetivo_Id === Objetivo.Id &&
      !Sub.Subobjetivo_Padre_Id &&
      !Sub.Parent_Subobjetivo_Id
    )).map(Construir_Subobjetivo);
    const Subobjetivos_Objetivo = Subobjetivos.filter((Sub) =>
      Sub.Objetivo_Id === Objetivo.Id
    );
    const Partes_Objetivo = Partes.filter((Parte) =>
      Parte.Objetivo_Id === Objetivo.Id ||
      Subobjetivos_Objetivo.some((Sub) =>
        Sub.Id === Parte.Subobjetivo_Id
      )
    );
    const Registros = Avances.filter((Avance) =>
      Avance.Objetivo_Id === Objetivo.Id ||
      Subobjetivos_Objetivo.some((Sub) =>
        Sub.Id === Avance.Subobjetivo_Id
      ) ||
      Partes_Objetivo.some((Parte) =>
        Parte.Id === Avance.Parte_Id
      )
    );
    return {
      ...Objetivo,
      Estadisticas: Estadisticas(
        Objetivo.Target_Actual || Objetivo.Target_Total,
        Objetivo.Progreso_Total,
        Registros,
        {
          Subobjetivos: Subobjetivos_Objetivo.length,
          Partes: Partes_Objetivo.length,
        }
      ),
      Objetivos_Hijos: Hijos,
      Subobjetivos: Subobjetivos_Raiz,
      Avances: Avances_De({ Objetivo_Id: Objetivo.Id }),
    };
  };
  return Ordenar(Objetivos.filter((Objetivo) =>
    !Objetivo.Objetivo_Padre_Id ||
    !Objetivos_Ids.has(Objetivo.Objetivo_Padre_Id)
  )).map(Construir_Objetivo);
}

function Responder_Tareas(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Rango = Resolver_Rango_Optional(Url);
  if (!Rango.Ok) {
    return Responder_Error(
      Rango.Status,
      Rango.Error,
      Rango.Detalle
    );
  }
  const Limite = Resolver_Limite(
    Url,
    50,
    100
  );
  const Cajon = Normalizar_Texto(
    Url.searchParams.get("cajon")
  );
  const Estado_Filtro = Normalizar_Texto(
    Url.searchParams.get("estado")
  ).toLowerCase();

  const Tareas =
    Construir_Tareas_Normalizadas_IA(Estado)
      .filter((Tarea) =>
        !Cajon ||
        Tarea.Cajon.toLowerCase() ===
          Cajon.toLowerCase()
      )
      .filter((Tarea) =>
        !Estado_Filtro ||
        Tarea.Estado.toLowerCase() ===
          Estado_Filtro
      )
      .filter((Tarea) => {
        if (!Rango.Desde || !Rango.Hasta) {
          return true;
        }
        if (!Tarea.Fecha) {
          return false;
        }
        return Tarea.Fecha >= Rango.Desde &&
          Tarea.Fecha <= Rango.Hasta;
      })
      .sort((A, B) => {
        const Clave_A =
          `${A.Fecha || "9999-12-31"}|${A.Hora || "99:99"}|${A.Nombre}`;
        const Clave_B =
          `${B.Fecha || "9999-12-31"}|${B.Hora || "99:99"}|${B.Nombre}`;
        return Clave_A.localeCompare(Clave_B);
      })
      .slice(0, Limite)
      .map((Tarea) => ({
        ...Tarea,
        Vinculos: Construir_Vinculos_Tarea_IA(
          Tarea as Mapa
        ),
      }));

  return Responder_Json({
    Ok: true,
    Tareas,
  });
}

function Responder_Habitos(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Fecha = Resolver_Fecha_Referencia(
    Url
  );
  if (!Fecha.Ok) {
    return Responder_Error(
      Fecha.Status,
      Fecha.Error,
      Fecha.Detalle
    );
  }
  const Limite = Resolver_Limite(
    Url,
    50,
    100
  );
  const Modo = Resolver_Modo_Habitos(Url);
  const Registros =
    Construir_Registros_Habitos_IA(Estado);
  const Habitos =
    Construir_Habitos_Normalizados_IA(Estado)
      .filter((Habito) =>
        Habito.Activo !== false &&
        Habito.Archivado !== true &&
        !Habito_Fecha_Inicio_Futura_IA(
          Habito,
          Fecha.Fecha
        )
      )
      .filter((Habito) =>
        Habito_Pasa_Contexto_IA(
          Habito,
          Fecha.Fecha,
          Modo
        )
      )
      .map((Habito) => {
        const Registros_Habito = Registros
          .filter((Registro) =>
            Registro.Habito_Id === Habito.Id &&
            Registro.Skip !== true
          )
          .sort((A, B) =>
            `${B.Fecha}|${B.Hora}`.localeCompare(
              `${A.Fecha}|${A.Hora}`
            )
          );
        return {
          ...Habito,
          Estado_Visible:
            Habito_Estado_Visible_IA(
              Habito,
              Fecha.Fecha,
              Registros
            ),
          Periodo_Clave:
            Habito_Clave_Periodo_IA(
              Habito,
              Fecha.Fecha
            ),
          Progreso_Actual:
            Habito_Progreso_IA(
              Habito,
              Fecha.Fecha,
              Registros
            ),
          Objetivo_Actual:
            Habito_Objetivo_IA(Habito),
          Ultimo_Registro:
            Registros_Habito[0] || null,
        };
      })
      .slice(0, Limite);

  return Responder_Json({
    Ok: true,
    Fecha: Fecha.Fecha,
    Modo,
    Rango: Resolver_Rango_Habitos(
      Fecha.Fecha,
      Modo
    ),
    Habitos,
  });
}

function Responder_Slots(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Rango = Resolver_Rango(Url);
  if (!Rango.Ok) {
    return Responder_Error(
      Rango.Status,
      Rango.Error,
      Rango.Detalle
    );
  }
  const Limite = Resolver_Limite(
    Url,
    100,
    200
  );
  return Responder_Json({
    Ok: true,
    Desde: Rango.Desde,
    Hasta: Rango.Hasta,
    Slots: Construir_Slots_Normalizados_IA(
      Estado,
      Rango.Desde,
      Rango.Hasta
    ).slice(0, Limite),
  });
}

function Responder_Planes_Semana(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Semana = Resolver_Semana(Url);
  if (!Semana.Ok) {
    return Responder_Error(
      Semana.Status,
      Semana.Error,
      Semana.Detalle
    );
  }
  return Responder_Json({
    Ok: true,
    Plan_Semana:
      Construir_Plan_Semana_Normalizado_IA(
        Estado,
        Semana.Semana
      ),
  });
}

function Responder_Planes_Periodos(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Modelo =
    Resolver_Modelo_Planes_Periodo_IA(Estado);
  const Periodo_Id = Normalizar_Texto(
    Url.searchParams.get("periodo_id")
  );
  const Tipo = Normalizar_Texto(
    Url.searchParams.get("tipo")
  );
  const Limite = Resolver_Limite(
    Url,
    50,
    100
  );
  const Incluir_Eliminados = ["1", "true", "si"]
    .includes(
      Normalizar_Texto(
        Url.searchParams.get("incluir_eliminados")
      ).toLowerCase()
    );

  if (!Periodo_Id) {
    let Periodos = Modelo.Periodos.slice();
    if (Tipo) {
      Periodos = Periodos.filter(
        (Periodo) => Periodo.Tipo === Tipo
      );
    }
    Periodos.sort((A, B) =>
      `${A.Inicio}|${A.Orden}`.localeCompare(
        `${B.Inicio}|${B.Orden}`
      )
    );
    return Responder_Json({
      Ok: true,
      Resumen:
        Construir_Resumen_Modelo_Planes_IA(
          Modelo
        ),
      Periodos: Periodos
        .slice(0, Limite)
        .map((Periodo) => ({
          ...Periodo,
          Objetivos_Total:
            Modelo.Objetivos.filter(
              (Objetivo) =>
                Objetivo.Periodo_Id ===
                Periodo.Id &&
                (Incluir_Eliminados ||
                  !Objetivo.Eliminado_Local)
            ).length,
          Subobjetivos_Total:
            Modelo.Subobjetivos.filter((Subobjetivo) =>
              (Incluir_Eliminados ||
                !Subobjetivo.Eliminado_Local) &&
              Modelo.Objetivos.some((Objetivo) =>
                Objetivo.Periodo_Id === Periodo.Id &&
                Objetivo.Id === Subobjetivo.Objetivo_Id
              )
            ).length,
          Partes_Total: Modelo.Partes.filter((Parte) =>
            (Incluir_Eliminados || !Parte.Eliminado_Local) &&
            Modelo.Subobjetivos.some((Subobjetivo) =>
              Subobjetivo.Id === Parte.Subobjetivo_Id &&
              Modelo.Objetivos.some((Objetivo) =>
                Objetivo.Periodo_Id === Periodo.Id &&
                Objetivo.Id === Subobjetivo.Objetivo_Id
              )
            )
          ).length,
        })),
    });
  }

  const Periodo = Modelo.Periodos.find(
    (Item) => Item.Id === Periodo_Id
  );
  if (!Periodo) {
    return Responder_Error(
      404,
      "Periodo inexistente",
      "No existe el periodo solicitado."
    );
  }

  const Periodos_Relevantes =
    Construir_Ids_Periodos_Relevantes_IA(
      Periodo.Id,
      Modelo.Periodos
    );
  const Objetivos = Modelo.Objetivos
    .filter((Objetivo) =>
      Objetivo.Periodo_Id &&
      Periodos_Relevantes.has(
        Objetivo.Periodo_Id
      ) &&
      (Incluir_Eliminados || !Objetivo.Eliminado_Local)
    );
  const Objetivos_Ids = new Set(
    Objetivos.map((Objetivo) => Objetivo.Id)
  );
  const Subobjetivos = Modelo.Subobjetivos
    .filter((Subobjetivo) =>
      Subobjetivo.Objetivo_Id &&
      Objetivos_Ids.has(
        Subobjetivo.Objetivo_Id
      ) &&
      (Incluir_Eliminados ||
        !Subobjetivo.Eliminado_Local)
    );
  const Subobjetivos_Ids = new Set(
    Subobjetivos.map((Subobjetivo) =>
      Subobjetivo.Id
    )
  );
  const Partes = Modelo.Partes
    .filter((Parte) =>
      Parte.Subobjetivo_Id &&
      Subobjetivos_Ids.has(
        Parte.Subobjetivo_Id
      ) &&
      (Incluir_Eliminados || !Parte.Eliminado_Local)
    );
  const Partes_Ids = new Set(
    Partes.map((Parte) => Parte.Id)
  );
  const Avances = Modelo.Avances
    .filter((Avance) =>
      (Avance.Objetivo_Id &&
        Objetivos_Ids.has(
          Avance.Objetivo_Id
        )) ||
      (Avance.Subobjetivo_Id &&
        Subobjetivos_Ids.has(
          Avance.Subobjetivo_Id
        )) ||
      (Avance.Parte_Id &&
        Partes_Ids.has(Avance.Parte_Id))
    )
    .sort((A, B) =>
      `${B.Fecha}|${B.Hora}|${B.Orden}`
        .localeCompare(
          `${A.Fecha}|${A.Hora}|${A.Orden}`
        )
    );

  return Responder_Json({
    Ok: true,
    Resumen:
      Construir_Resumen_Modelo_Planes_IA(
        Modelo
      ),
    Periodo,
    Periodos_Hijos: Modelo.Periodos.filter(
      (Item) => Item.Parent_Id === Periodo.Id
    ),
    Objetivos,
    Subobjetivos,
    Partes,
    Avances,
    Arbol: Construir_Arbol_Planes_IA(
      Objetivos,
      Subobjetivos,
      Partes,
      Avances
    ),
  });
}

function Normalizar_Tipo_Periodo_Metas_Compatibilidad(
  Valor: unknown
) {
  const Texto = Normalizar_Texto_Busqueda(Valor);
  if (Texto === "anio" || Texto === "ano") return "Anio";
  if (Texto === "semestre") return "Semestre";
  if (Texto === "trimestre") return "Trimestre";
  if (Texto === "mes") return "Mes";
  return "";
}

function Resolver_Fecha_Metas_Compatibilidad(
  Url: URL
) {
  const Fecha = Normalizar_Texto(
    Url.searchParams.get("fecha")
  );
  return Es_Fecha_ISO_Valida(Fecha)
    ? Fecha
    : Fecha_Argentina_B2();
}

function Responder_Metas_Compatibilidad(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Url_Planes = new URL(Url.toString());
  if (Url_Planes.searchParams.get("periodo_id")) {
    return Responder_Planes_Periodos(
      Estado,
      Url_Planes
    );
  }

  const Tipo =
    Normalizar_Tipo_Periodo_Metas_Compatibilidad(
      Url_Planes.searchParams.get("tipo") ||
        Url_Planes.searchParams.get("periodo")
    ) || "Trimestre";
  const Fecha =
    Resolver_Fecha_Metas_Compatibilidad(
      Url_Planes
    );
  const Modelo =
    Resolver_Modelo_Planes_Periodo_IA(Estado);
  const Periodo = Modelo.Periodos.find((Item) =>
    Item.Tipo === Tipo &&
    Item.Inicio <= Fecha &&
    Item.Fin >= Fecha
  );

  Url_Planes.searchParams.set("tipo", Tipo);
  if (Periodo?.Id) {
    Url_Planes.searchParams.set(
      "periodo_id",
      Periodo.Id
    );
  }

  const Respuesta = Responder_Planes_Periodos(
    Estado,
    Url_Planes
  );
  Respuesta.headers.set(
    "X-Semaplan-Deprecated-Route",
    "/metas usa Planes_Periodo; preferir /planes/periodos."
  );
  return Respuesta;
}

function Responder_Archivero(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Limite = Resolver_Limite(
    Url,
    50,
    100
  );
  const Cajon_Id = Normalizar_Texto(
    Url.searchParams.get("cajon_id")
  );
  const Cajones =
    Construir_Cajones_Archivero_IA(
      Estado
    );
  const Cajon = Cajon_Id
    ? Cajones.find((Item) => Item.Id === Cajon_Id)
    : Cajones[0];

  if (Cajon_Id && !Cajon) {
    return Responder_Error(
      404,
      "Cajon inexistente",
      "No existe el cajon de Archivero solicitado."
    );
  }

  const Notas =
    Construir_Notas_Archivero_IA(Estado)
      .filter((Nota) =>
        Cajon ? Nota.Archivero_Id === Cajon.Id : false
      )
      .sort((A, B) =>
        String(B._Orden_Fecha).localeCompare(
          String(A._Orden_Fecha)
        )
      )
      .slice(0, Limite)
      .map(
        ({
          _Orden_Fecha,
          _Busqueda,
          ...Nota
        }) => Nota
      );

  return Responder_Json({
    Ok: true,
    Cajones: Cajones.map(
      ({ Orden, ...Item }) => Item
    ),
    Cajon: Cajon
      ? {
          Id: Cajon.Id,
          Nombre: Cajon.Nombre,
          Emoji: Cajon.Emoji,
          Notas_Total: Cajon.Notas_Total,
        }
      : null,
    Notas,
  });
}

function Responder_Archivero_Buscar(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Query = Normalizar_Texto(
    Url.searchParams.get("q")
  );
  if (!Query) {
    return Responder_Error(
      400,
      "Busqueda vacia",
      "La busqueda requiere el parametro q."
    );
  }
  if (Query.length > 200) {
    return Responder_Error(
      400,
      "Busqueda demasiado larga",
      "La busqueda admite hasta 200 caracteres."
    );
  }
  const Limite = Resolver_Limite(
    Url,
    20,
    50
  );
  const Query_Normalizada =
    Normalizar_Texto_Busqueda(Query);
  const Cajones_Por_Id = new Map(
    Construir_Cajones_Archivero_IA(Estado).map(
      (Cajon) => [Cajon.Id, Cajon]
    )
  );
  const Resultados =
    Construir_Notas_Archivero_IA(Estado)
      .filter((Nota) =>
        Nota._Busqueda.includes(
          Query_Normalizada
        )
      )
      .sort((A, B) =>
        String(B._Orden_Fecha).localeCompare(
          String(A._Orden_Fecha)
        )
      )
      .slice(0, Limite)
      .map(
        ({
          _Orden_Fecha,
          _Busqueda,
          ...Nota
        }) => ({
          ...Nota,
          Cajon: (() => {
            const Cajon =
              Cajones_Por_Id.get(
                Nota.Archivero_Id
              ) || null;
            return Cajon
              ? {
                  Id: Cajon.Id,
                  Nombre: Cajon.Nombre,
                  Emoji: Cajon.Emoji,
                }
              : null;
          })(),
        })
      );

  return Responder_Json({
    Ok: true,
    Query,
    Resultados,
  });
}

function Responder_Baul(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Categoria = Normalizar_Texto(
    Url.searchParams.get("categoria")
  ).toLowerCase();
  const Estado_Filtro = Normalizar_Texto(
    Url.searchParams.get("estado")
  ).toLowerCase();
  const Limite = Resolver_Limite(
    Url,
    100,
    100
  );
  const Objetivos =
    Construir_Baul_Normalizado_IA(Estado)
      .filter((Objetivo) =>
        !Categoria ||
        Objetivo.Categoria.toLowerCase() ===
          Categoria ||
        String(
          Objetivo.Categoria_Id || ""
        ).toLowerCase() === Categoria
      )
      .filter((Objetivo) =>
        !Estado_Filtro ||
        Objetivo.Estado.toLowerCase() ===
          Estado_Filtro
      )
      .sort((A, B) =>
        `${A.Orden}|${A.Timeline || "9999-12-31"}|${A.Nombre}`
          .localeCompare(
            `${B.Orden}|${B.Timeline || "9999-12-31"}|${B.Nombre}`
          )
      )
      .slice(0, Limite);

  return Responder_Json({
    Ok: true,
    Objetivos,
  });
}

function Construir_Vinculos_Tarea_IA(
  Tarea: Record<string, unknown>
) {
  const Vinculos: string[] = [];
  if (Normalizar_Texto(Tarea.Evento_Id)) {
    Vinculos.push("Evento de agenda");
  }
  if (Normalizar_Texto(Tarea.Abordaje_Id)) {
    Vinculos.push("Abordaje de agenda");
  }
  if (Normalizar_Texto(Tarea.Plan_Clave)) {
    Vinculos.push("Plan de slot");
  }
  if (Normalizar_Texto(Tarea.Plan_Item_Id)) {
    Vinculos.push("Item de plan");
  }
  return Vinculos;
}

function Responder_Busqueda_Global(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Query = Normalizar_Texto(Url.searchParams.get("q"));
  const Modulo = Normalizar_Texto_Busqueda(
    Url.searchParams.get("modulo") || "todos"
  );
  if (!['todos', 'decoteca'].includes(Modulo)) {
    return Responder_Error(
      400,
      "Busqueda invalida",
      "modulo admite todos o decoteca."
    );
  }
  if (!Query && Modulo !== "decoteca") {
    return Responder_Error(
      400,
      "Busqueda invalida",
      "El parametro q es obligatorio salvo para listar Decoteca."
    );
  }
  const Texto = Normalizar_Texto_Busqueda(Query);
  const Limite = Resolver_Limite(Url, 30, 100);
  const Offset = Resolver_Offset(Url);
  const Filtros = Resolver_Filtros_Decoteca(Url);
  const Compacto = Resolver_Compacto_Decoteca(Url);
  const Resultados: Mapa[] = [];
  if (Modulo === "decoteca") {
    const Decoteca = Construir_Resultados_Decoteca_Busqueda(
      Estado,
      Url,
      Texto,
      {
        Paginado: true,
        Compacto,
        Filtros,
        Offset,
        Limite,
      },
    );
    return Responder_Json({
      Ok: true,
      Query,
      Modulo,
      Resultados: Decoteca.Resultados,
      Total: Decoteca.Total,
      Offset: Decoteca.Offset,
      Limite: Decoteca.Limite,
      Hay_Mas: Decoteca.Hay_Mas,
      Siguiente_Offset: Decoteca.Siguiente_Offset,
      Filtros,
      Compacto,
    });
  }
  if (Modulo === "todos") Construir_Tareas_Normalizadas_IA(Estado).forEach((Tarea) => {
    if (Normalizar_Texto_Busqueda([Tarea.Nombre, Tarea.Cajon].join(" ")).includes(Texto)) {
      Resultados.push({
        Tipo: "Tarea",
        Id: Tarea.Id,
        Nombre: Tarea.Nombre,
        Estado: Tarea.Estado,
        Fecha: Tarea.Fecha || null,
        Hora: Tarea.Hora || null,
        Vinculos: Construir_Vinculos_Tarea_IA(Tarea),
      });
    }
  });
  if (Modulo === "todos") Construir_Habitos_Normalizados_IA(Estado).forEach((Habito) => {
    if (Normalizar_Texto_Busqueda(Habito.Nombre).includes(Texto)) {
      Resultados.push({ Tipo: "Habito", Id: Habito.Id, Nombre: Habito.Nombre });
    }
  });
  if (Modulo === "todos") Construir_Baul_Normalizado_IA(Estado).forEach((Item) => {
    if (Normalizar_Texto_Busqueda([Item.Nombre, Item.Descripcion, Item.Categoria].join(" ")).includes(Texto)) {
      Resultados.push({ Tipo: "Baul", Id: Item.Id, Nombre: Item.Nombre, Estado: Item.Estado });
    }
  });
  if (Modulo === "todos") Construir_Notas_Archivero_IA(Estado).forEach((Nota) => {
    if (Nota._Busqueda.includes(Texto)) {
      Resultados.push({ Tipo: "Nota", Id: Nota.Id, Nombre: Nota.Titulo || Nota.Texto.slice(0, 100) });
    }
  });
  if (Modulo === "todos") {
    const Modelo = Resolver_Modelo_Planes_Periodo_IA(Estado);
    [
    ...Modelo.Objetivos.map((Item) => ({ Tipo: "Objetivo", Item })),
    ...Modelo.Subobjetivos.map((Item) => ({ Tipo: "Subobjetivo", Item })),
    ...Modelo.Partes.map((Item) => ({ Tipo: "Parte", Item })),
    ].forEach(({ Tipo, Item }) => {
      const Base = Item as Mapa;
      const Nombre = Normalizar_Texto(Base.Nombre || Base.Texto);
      const Descripcion = Normalizar_Texto(Base.Descripcion);
      if (!Base.Eliminado_Local && Normalizar_Texto_Busqueda(`${Nombre} ${Descripcion}`).includes(Texto)) {
        Resultados.push({ Tipo, Id: Base.Id, Nombre, Periodo_Id: Base.Periodo_Id || null });
      }
    });
  }
  const Decoteca = Construir_Resultados_Decoteca_Busqueda(
    Estado,
    Url,
    Texto,
    {
      Paginado: false,
      Compacto: false,
      Filtros: {},
      Offset: 0,
      Limite: Number.MAX_SAFE_INTEGER,
    },
  );
  Decoteca.Resultados.forEach((Resultado) =>
    Resultados.push(Resultado)
  );
  return Responder_Json({
    Ok: true,
    Query,
    Modulo,
    Resultados: Resultados.slice(0, Limite),
    Total: Resultados.length,
  });
}

function Construir_Resultados_Decoteca_Busqueda(
  Estado: Record<string, unknown>,
  Url: URL,
  Texto: string,
  Opciones: {
    Paginado: boolean;
    Compacto: boolean;
    Filtros: Mapa;
    Offset: number;
    Limite: number;
  }
) {
  const Decoteca = Leer_Decoteca_B2(Estado as Mapa);
  const Teca_Filtro = Normalizar_Teca_Id_Decoteca_B2(
    Url.searchParams.get("teca_id") || ""
  );
  const Tecas_Por_Id = new Map(
    Decoteca.Tecas.map((Teca) => [String(Teca.Id || ""), Teca])
  );
  const Avances_Por_Obra = new Map<string, Mapa[]>();
  Decoteca.Avances.forEach((Avance) => {
    const Obra_Id = String(Avance.Obra_Id || "").trim();
    if (!Obra_Id) return;
    const Lista = Avances_Por_Obra.get(Obra_Id) || [];
    Lista.push({ ...Avance });
    Avances_Por_Obra.set(Obra_Id, Lista);
  });
  const Obras_Con_Texto = Decoteca.Obras.filter((Obra) => {
    const Teca_Id = String(Obra.Teca_Id || "").trim();
    if (Teca_Filtro && Teca_Id !== Teca_Filtro) return false;
    const Metadatos = Array.isArray(Obra.Metadatos)
      ? Obra.Metadatos.flat().join(" ")
      : "";
    const Partes = Array.isArray(Obra.Partes)
      ? Obra.Partes.map((Parte) => {
        const Base = Es_Mapa_B2(Parte) ? Parte : {};
        return [Base.Titulo, Base.Tipo, Base.Metadatos].flat().join(" ");
      }).join(" ")
      : "";
    const Teca = Tecas_Por_Id.get(Teca_Id) || {};
    return !Texto || Normalizar_Texto_Busqueda([
      Obra.Titulo,
      Obra.Creador,
      Obra.Anio,
      Obra.Genero,
      Obra.Subgenero,
      Obra.Descripcion,
      Teca.Nombre,
      Metadatos,
      Partes,
    ].join(" ")).includes(Texto);
  });
  const Pagina = Seleccionar_Pagina_Decoteca({
    Obras: Obras_Con_Texto,
    Teca_Id: "",
    Filtros: Opciones.Paginado ? Opciones.Filtros : {},
    Offset: Opciones.Paginado ? Opciones.Offset : 0,
    Limite: Opciones.Paginado
      ? Opciones.Limite
      : Math.max(1, Decoteca.Obras.length),
  });
  const Resultados = Pagina.Obras.map((Obra) => {
    const Copia_Obra = { ...Obra };
    delete Copia_Obra.Portada_Data_Url;
    delete Copia_Obra.Portada_Data;
    delete Copia_Obra.Portada_Ruta_Local;
    delete Copia_Obra.Portada_Ruta;
    delete Copia_Obra.Portada_Metodo_Local;
    const Teca_Id = String(Obra.Teca_Id || "").trim();
    const Teca = Tecas_Por_Id.get(Teca_Id) || {};
    const Obra_Respuesta = Opciones.Compacto
      ? Construir_Obra_Compacta_Decoteca(Obra)
      : Copia_Obra;
    const Respuesta: Mapa = {
      Tipo: "Obra_Decoteca",
      Id: Obra.Id,
      Teca_Id,
      Teca: Teca.Nombre || Teca_Id,
      Nombre: Obra.Titulo || "",
      Obra: Obra_Respuesta,
    };
    if (!Opciones.Compacto) {
      Respuesta.Registros =
        Avances_Por_Obra.get(String(Obra.Id || "")) || [];
    } else {
      Respuesta.Registros_Total =
        (Avances_Por_Obra.get(String(Obra.Id || "")) || []).length;
    }
    return Respuesta;
  });
  return {
    Resultados,
    Total: Pagina.Total,
    Offset: Pagina.Offset,
    Limite: Pagina.Limite,
    Hay_Mas: Pagina.Hay_Mas,
    Siguiente_Offset: Pagina.Siguiente_Offset,
  };
}

function Responder_Resumen_Operativo(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Fecha = Resolver_Fecha_Referencia(Url);
  if (!Fecha.Ok) return Responder_Error(Fecha.Status, Fecha.Error, Fecha.Detalle);
  const Periodo = Normalizar_Texto(Url.searchParams.get("periodo")).toLowerCase() || "dia";
  if (!["dia", "semana"].includes(Periodo)) {
    return Responder_Error(400, "Periodo invalido", "periodo admite dia o semana.");
  }
  const Desde = Periodo === "semana"
    ? Obtener_Lunes_ISO_Desde_Fecha(Fecha.Fecha) || Fecha.Fecha
    : Fecha.Fecha;
  const Hasta = Periodo === "semana"
    ? Formatear_Fecha_ISO(Sumar_Dias(Parsear_Fecha_ISO(Desde)!, 6))
    : Desde;
  const Tareas = Construir_Tareas_Normalizadas_IA(Estado);
  const Pendientes = Tareas.filter((Tarea) =>
    Tarea.Estado === "pendiente" && Tarea.Fecha &&
    Tarea.Fecha >= Desde && Tarea.Fecha <= Hasta
  );
  const Vencidas = Tareas.filter((Tarea) =>
    Tarea.Estado === "pendiente" && Tarea.Fecha && Tarea.Fecha < Desde
  );
  return Responder_Json({
    Ok: true,
    Periodo: { Tipo: Periodo, Desde, Hasta },
    Prioridades: Pendientes.slice(0, 12),
    Tareas_Vencidas: Vencidas.slice(0, 12),
    Agenda: Construir_Bloques_Agenda(Estado, Desde, Hasta),
    Tareas: Construir_Resumen_Tareas(Estado, Desde, Hasta),
    Habitos: Construir_Resumen_Habitos(Estado, Desde, Hasta),
    Planes: Construir_Resumen_Modelo_Planes_IA(
      Resolver_Modelo_Planes_Periodo_IA(Estado)
    ),
  });
}

function Responder_Diagnostico_Planes(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Modelo = Resolver_Modelo_Planes_Periodo_IA(Estado);
  const Fecha = Resolver_Fecha_Referencia(Url);
  if (!Fecha.Ok) return Responder_Error(Fecha.Status, Fecha.Error, Fecha.Detalle);
  const Periodo_Id = Normalizar_Texto(Url.searchParams.get("periodo_id"));
  const Periodo = Periodo_Id
    ? Modelo.Periodos.find((Item) => Item.Id === Periodo_Id)
    : Modelo.Periodos.find((Item) => Item.Inicio <= Fecha.Fecha && Item.Fin >= Fecha.Fecha);
  if (!Periodo) return Responder_Error(404, "Periodo inexistente", "No encontre un periodo para diagnosticar.");
  const Objetivos = Modelo.Objetivos.filter((Item) =>
    Item.Periodo_Id === Periodo.Id && !Item.Eliminado_Local
  );
  const Subobjetivos = Modelo.Subobjetivos.filter((Item) => !Item.Eliminado_Local);
  const Partes = Modelo.Partes.filter((Item) => !Item.Eliminado_Local);
  const Avances = Modelo.Avances;
  const Problemas: Mapa[] = [];
  Objetivos.forEach((Objetivo) => {
    const Hijos = Subobjetivos.filter((Item) => Item.Objetivo_Id === Objetivo.Id);
    const Partes_Objetivo = Partes.filter((Item) => Item.Objetivo_Id === Objetivo.Id || Hijos.some((Sub) => Sub.Id === Item.Subobjetivo_Id));
    const Registros = Avances.filter((Item) => Item.Objetivo_Id === Objetivo.Id || Hijos.some((Sub) => Sub.Id === Item.Subobjetivo_Id) || Partes_Objetivo.some((Parte) => Parte.Id === Item.Parte_Id));
    if (!Hijos.length) Problemas.push({ Tipo: "Sin_Subobjetivos", Objetivo_Id: Objetivo.Id, Nombre: Objetivo.Nombre });
    if (Hijos.length && !Partes_Objetivo.length) Problemas.push({ Tipo: "Sin_Partes", Objetivo_Id: Objetivo.Id, Nombre: Objetivo.Nombre });
    if (!Registros.length) Problemas.push({ Tipo: "Sin_Avances", Objetivo_Id: Objetivo.Id, Nombre: Objetivo.Nombre });
    if (Objetivo.Fecha_Objetivo && Objetivo.Fecha_Objetivo < Fecha.Fecha && Number(Objetivo.Progreso_Total || 0) < Number(Objetivo.Target_Total || 0)) {
      Problemas.push({ Tipo: "Vencido", Objetivo_Id: Objetivo.Id, Nombre: Objetivo.Nombre });
    }
  });
  return Responder_Json({ Ok: true, Periodo, Problemas, Objetivos_Total: Objetivos.length });
}

function Responder_Metas(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Limite = Resolver_Limite(
    Url,
    50,
    100
  );
  const Metas =
    Construir_Metas_Normalizadas_IA(Estado)
      .sort((A, B) =>
        `${Number(A.Archivada)}|${A.Fecha_Hasta}|${A.Nombre}`
          .localeCompare(
            `${Number(B.Archivada)}|${B.Fecha_Hasta}|${B.Nombre}`
          )
      )
      .slice(0, Limite);

  return Responder_Json({
    Ok: true,
    Metas,
  });
}

function Responder_Agenda(
  Estado: Record<string, unknown>,
  Url: URL
) {
  const Rango = Resolver_Rango(Url);
  if (!Rango.Ok) {
    return Responder_Error(
      Rango.Status,
      Rango.Error,
      Rango.Detalle
    );
  }
  return Responder_Json({
    Ok: true,
    Desde: Rango.Desde,
    Hasta: Rango.Hasta,
    Bloques: Construir_Bloques_Agenda(
      Estado,
      Rango.Desde,
      Rango.Hasta
    ),
  });
}

function Responder_Contexto(
  Estado: Record<string, unknown>,
  Version: number,
  Actualizado_En: string | null,
  Url: URL
) {
  const Rango = Resolver_Rango(Url);
  if (!Rango.Ok) {
    return Responder_Error(
      Rango.Status,
      Rango.Error,
      Rango.Detalle
    );
  }

  const Bloques_Agenda =
    Construir_Bloques_Agenda(
      Estado,
      Rango.Desde,
      Rango.Hasta
    );

  return Responder_Json({
    Ok: true,
    Contexto: {
      Desde: Rango.Desde,
      Hasta: Rango.Hasta,
      Version_Estado: Version,
      Actualizado_En,
      Agenda: {
        Bloques_Total:
          Bloques_Agenda.length,
        Eventos_Total:
          Bloques_Agenda.filter((Bloque) =>
            Bloque.Tipo === "Evento"
          ).length,
        Slots_Muertos_Total:
          Bloques_Agenda.filter((Bloque) =>
            Bloque.Tipo === "Slot_Muerto"
          ).length,
        Planes_Slot_Total:
          Bloques_Agenda.filter((Bloque) =>
            Bloque.Plan_Slot
          ).length,
        Proximos_Bloques:
          Bloques_Agenda.slice(0, 15),
      },
      Tareas: Construir_Resumen_Tareas(
        Estado,
        Rango.Desde,
        Rango.Hasta
      ),
      Habitos: Construir_Resumen_Habitos(
        Estado,
        Rango.Desde,
        Rango.Hasta
      ),
      Slots: Construir_Resumen_Slots(
        Estado
      ),
      Planes_Semana:
        Construir_Resumen_Planes_Semana(
          Estado,
          Rango.Desde,
          Rango.Hasta
        ),
      Planes_Periodo:
        Construir_Resumen_Planes_Periodo(
          Estado
        ),
      Archivero: Construir_Resumen_Archivero(
        Estado
      ),
      Baul: Construir_Resumen_Baul(
        Estado
      ),
    },
  });
}

type Estado_Completo_B2 =
  | {
    Ok: true;
    Estado: Mapa;
    Version: number;
    Actualizado_En: string | null;
  }
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

type Resultado_Mutacion_B2 = {
  Respuesta: string;
  Resultado?: Mapa;
  Cambios?: boolean;
  Status?: number;
  Error?: string;
};

type Handler_B2 = (
  Estado: Mapa,
  Payload: Mapa,
) => Resultado_Mutacion_B2;

const Timezone_Argentina = "America/Argentina/Buenos_Aires";

const Rutas_B2: Record<string, {
  Scope: string;
  Accion: string;
  Handler: Handler_B2;
}> = {
  "/b2/tareas/crear": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "crear_tarea",
    Handler: B2_Crear_Tarea,
  },
  "/b2/tareas/marcar": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "marcar_tarea",
    Handler: B2_Marcar_Tarea,
  },
  "/b2/tareas/reprogramar": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "reprogramar_tarea",
    Handler: B2_Reprogramar_Tarea,
  },
  "/b2/tareas/editar": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "editar_tarea",
    Handler: B2_Editar_Tarea,
  },
  "/b2/tareas/borrar": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "borrar_tarea",
    Handler: B2_Borrar_Tarea,
  },
  "/b2/tareas/duplicar": {
    Scope: OAUTH_SCOPE_TAREAS,
    Accion: "duplicar_tarea",
    Handler: B2_Duplicar_Tarea,
  },
  "/b2/habitos/crear": {
    Scope: OAUTH_SCOPE_HABITOS,
    Accion: "crear_habito",
    Handler: B2_Crear_Habito,
  },
  "/b2/habitos/registrar": {
    Scope: OAUTH_SCOPE_HABITOS,
    Accion: "registrar_habito",
    Handler: B2_Registrar_Habito,
  },
  "/b2/planes/objetivos": {
    Scope: OAUTH_SCOPE_METAS,
    Accion: "mutar_objetivo_plan",
    Handler: B2_Mutar_Objetivo_Plan,
  },
  "/b2/planes/subobjetivos": {
    Scope: OAUTH_SCOPE_METAS,
    Accion: "mutar_subobjetivo_plan",
    Handler: B2_Mutar_Subobjetivo_Plan,
  },
  "/b2/planes/partes": {
    Scope: OAUTH_SCOPE_METAS,
    Accion: "mutar_parte_plan",
    Handler: B2_Mutar_Parte_Plan,
  },
  "/b2/planes/avances": {
    Scope: OAUTH_SCOPE_METAS,
    Accion: "mutar_avance_plan",
    Handler: B2_Mutar_Avance_Plan,
  },
  "/b2/archivero/nota": {
    Scope: OAUTH_SCOPE_ARCHIVERO,
    Accion: "crear_nota_archivero",
    Handler: B2_Crear_Nota_Archivero,
  },
  "/b2/baul/item": {
    Scope: OAUTH_SCOPE_BAUL,
    Accion: "crear_item_baul",
    Handler: B2_Crear_Item_Baul,
  },
  "/b2/decoteca/obra": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "crear_obra_decoteca",
    Handler: B2_Crear_Obra_Decoteca,
  },
  "/b2/decoteca/obra/editar": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "editar_obra_decoteca",
    Handler: B2_Editar_Obra_Decoteca,
  },
  "/b2/decoteca/obra/borrar": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "borrar_obra_decoteca",
    Handler: B2_Borrar_Obra_Decoteca,
  },
  "/b2/decoteca/teca": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "crear_teca_decoteca",
    Handler: B2_Crear_Teca_Decoteca,
  },
  "/b2/decoteca/teca/editar": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "editar_teca_decoteca",
    Handler: B2_Editar_Teca_Decoteca,
  },
  "/b2/decoteca/teca/borrar": {
    Scope: OAUTH_SCOPE_DECOTECA,
    Accion: "borrar_teca_decoteca",
    Handler: B2_Borrar_Teca_Decoteca,
  },
};

async function Leer_Body_Json_B2(
  Req: Request
): Promise<Mapa> {
  try {
    const Json = await Req.json();
    return Es_Mapa_B2(Json) ? Json : {};
  } catch (_) {
    return {};
  }
}

async function Responder_B2(
  Req: Request,
  Auth: Extract<Auth_Resultado, { Ok: true }>,
  Config: typeof Rutas_B2[string],
) {
  if (!Tiene_Scope(Auth.Scopes, Config.Scope)) {
    return Responder_Error(
      403,
      "Scope insuficiente",
      `La accion requiere ${Config.Scope}.`
    );
  }
  const Payload = await Leer_Body_Json_B2(Req);
  return await Mutar_Estado_B2(
    Auth.Usuario_Id,
    Config.Accion,
    Config.Scope,
    Payload,
    (Estado) => Config.Handler(Estado, Payload)
  );
}

function Resolver_Tareas_Lote_B2(
  Estado: Mapa,
  Payload: Mapa
) {
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Ids = [...new Set(
    Leer_Array_String_B2(Payload, "tareas_ids", "Tareas_Ids")
  )];
  if (Ids.length) {
    if (Ids.length > 50) {
      return {
        Ok: false as const,
        Detalle: "La operacion masiva admite hasta 50 tareas.",
      };
    }
    const Encontradas = Ids.map((Id) => Tareas.find((Tarea) => String(Tarea.Id || "") === Id)).filter(Boolean) as Mapa[];
    if (Encontradas.length !== Ids.length) return { Ok: false as const, Detalle: "Una o mas tareas_ids no existen." };
    return { Ok: true as const, Tareas: Encontradas };
  }
  const Busqueda = Normalizar_Texto_Busqueda(Payload.busqueda || Payload.nombre);
  if (!Busqueda) return { Ok: false as const, Detalle: "Indica tareas_ids o busqueda para el lote." };
  const Encontradas = Tareas.filter((Tarea) => Normalizar_Texto_Busqueda(Tarea.Nombre).includes(Busqueda));
  if (!Encontradas.length) return { Ok: false as const, Detalle: "No encontre tareas para la busqueda indicada." };
  if (Encontradas.length > 50) return { Ok: false as const, Detalle: "La operacion masiva admite hasta 50 tareas." };
  return { Ok: true as const, Tareas: Encontradas };
}

function Resolver_Operaciones_Lote_Tareas_B2(Payload: Mapa) {
  if (!("operaciones" in Payload)) {
    return { Ok: true as const, Operaciones: [Payload] };
  }
  if (!Array.isArray(Payload.operaciones) || !Payload.operaciones.length) {
    return {
      Ok: false as const,
      Detalle: "operaciones debe contener al menos un cambio.",
    };
  }
  if (Payload.operaciones.length > 50) {
    return {
      Ok: false as const,
      Detalle: "La operacion masiva admite hasta 50 cambios.",
    };
  }
  const Operaciones: Mapa[] = [];
  for (const [Indice, Item] of Payload.operaciones.entries()) {
    if (!Es_Mapa_B2(Item)) {
      return {
        Ok: false as const,
        Detalle: `El cambio ${Indice + 1} no es valido.`,
      };
    }
    const Operacion = Leer_String_B2(Item, "operacion").toLowerCase();
    if (!["marcar", "reprogramar", "editar", "borrar"].includes(Operacion)) {
      return {
        Ok: false as const,
        Detalle:
          `El cambio ${Indice + 1} debe usar marcar, reprogramar, editar o borrar.`,
      };
    }
    const Tiene_Destino = Leer_Array_String_B2(
      Item,
      "tareas_ids",
      "Tareas_Ids"
    ).length || Leer_String_B2(Item, "busqueda", "nombre");
    if (!Tiene_Destino) {
      return {
        Ok: false as const,
        Detalle:
          `El cambio ${Indice + 1} necesita tareas_ids o busqueda.`,
      };
    }
    Operaciones.push({ ...Item, operacion: Operacion });
  }
  return { Ok: true as const, Operaciones };
}

function Construir_Plan_Lote_Tareas_B2(
  Estado: Mapa,
  Operaciones: Mapa[]
) {
  const Ids_Usados = new Set<string>();
  const Pasos: Array<{
    Operacion: string;
    Payload: Mapa;
    Tareas: Mapa[];
  }> = [];
  for (const [Indice, Payload] of Operaciones.entries()) {
    const Seleccion = Resolver_Tareas_Lote_B2(Estado, Payload);
    if (!Seleccion.Ok) {
      return {
        Ok: false as const,
        Detalle: `El cambio ${Indice + 1} no es valido: ${Seleccion.Detalle}`,
      };
    }
    for (const Tarea of Seleccion.Tareas) {
      const Id = String(Tarea.Id || "");
      if (Ids_Usados.has(Id)) {
        return {
          Ok: false as const,
          Detalle:
            `La tarea ${String(Tarea.Nombre || Id)} aparece en mas de un cambio.`,
        };
      }
      Ids_Usados.add(Id);
    }
    if (Ids_Usados.size > 50) {
      return {
        Ok: false as const,
        Detalle: "La operacion masiva admite hasta 50 tareas en total.",
      };
    }
    Pasos.push({
      Operacion: Leer_String_B2(Payload, "operacion").toLowerCase(),
      Payload,
      Tareas: Seleccion.Tareas,
    });
  }
  return { Ok: true as const, Pasos };
}

function Construir_Vista_Previa_Lote_Tareas_B2(
  Pasos: Array<{ Operacion: string; Tareas: Mapa[] }>
) {
  return Pasos.flatMap((Paso, Indice) => Paso.Tareas.map((Tarea) => ({
    paso: Indice + 1,
    operacion: Paso.Operacion,
    tarea_id: Tarea.Id,
    nombre: Tarea.Nombre,
    fecha: Tarea.Fecha || null,
    hora: Tarea.Hora || null,
    vinculos: Construir_Vinculos_Tarea_IA(Tarea),
  })));
}

async function Responder_Lote_Tareas_B2(
  Req: Request,
  Auth: Extract<Auth_Resultado, { Ok: true }>
) {
  if (!Tiene_Scope(Auth.Scopes, OAUTH_SCOPE_TAREAS)) {
    return Responder_Error(403, "Scope insuficiente", `La accion requiere ${OAUTH_SCOPE_TAREAS}.`);
  }
  const Payload = await Leer_Body_Json_B2(Req);
  const Operaciones = Resolver_Operaciones_Lote_Tareas_B2(Payload);
  if (!Operaciones.Ok) {
    return Responder_Error(400, "Operacion invalida", Operaciones.Detalle);
  }
  const Fila = await Leer_Estado_Usuario_Completo_B2(Auth.Usuario_Id);
  if (!Fila.Ok) return Responder_Error(Fila.Status, Fila.Error, Fila.Detalle);
  const Plan = Construir_Plan_Lote_Tareas_B2(
    Clonar_B2(Fila.Estado),
    Operaciones.Operaciones
  );
  if (!Plan.Ok) return Responder_Error(400, "Seleccion invalida", Plan.Detalle);
  const Vista_Previa = Construir_Vista_Previa_Lote_Tareas_B2(Plan.Pasos);
  if (!Leer_Boolean_B2(Payload, false, "confirmar_aplicacion")) {
    return Responder_Json({
      Ok: true,
      Previsualizacion: true,
      Operacion: Plan.Pasos.length === 1 ? Plan.Pasos[0].Operacion : "mixta",
      Cantidad: Vista_Previa.length,
      Tareas: Vista_Previa,
      Operaciones: Plan.Pasos.map((Paso, Indice) => ({
        paso: Indice + 1,
        operacion: Paso.Operacion,
        cantidad: Paso.Tareas.length,
      })),
      Instruccion: "Repeti la misma llamada con confirmar_aplicacion: true para aplicar el cambio.",
    });
  }
  return await Mutar_Estado_B2(
    Auth.Usuario_Id,
    "lote_tareas",
    OAUTH_SCOPE_TAREAS,
    Payload,
    (Estado) => {
      const Plan_Actual = Construir_Plan_Lote_Tareas_B2(
        Estado,
        Operaciones.Operaciones
      );
      if (!Plan_Actual.Ok) return Error_Mutacion_B2(Plan_Actual.Detalle);
      for (const Paso of Plan_Actual.Pasos) {
        for (const Tarea of Paso.Tareas) {
          const Base = {
            ...Paso.Payload,
            tarea_id: Tarea.Id,
            confirmar_eliminacion: true,
          };
          const Resultado = Paso.Operacion === "marcar"
            ? B2_Marcar_Tarea(Estado, Base)
            : Paso.Operacion === "reprogramar"
            ? B2_Reprogramar_Tarea(Estado, Base)
            : Paso.Operacion === "editar"
            ? B2_Editar_Tarea(Estado, Base)
            : B2_Borrar_Tarea(Estado, Base);
          if (Resultado.Cambios === false) return Resultado;
        }
      }
      return {
        Respuesta: `Operacion masiva aplicada sobre ${Vista_Previa.length} tareas.`,
        Resultado: {
          operaciones: Plan_Actual.Pasos.map((Paso, Indice) => ({
            paso: Indice + 1,
            operacion: Paso.Operacion,
            cantidad: Paso.Tareas.length,
          })),
          tareas: Vista_Previa,
        },
      };
    }
  );
}

type Operacion_General_Lote_B2 = {
  Accion: string;
  Payload: Mapa;
  Config: typeof Rutas_B2[string];
};

function Resolver_Operaciones_Generales_Lote_B2(Payload: Mapa) {
  if (!Array.isArray(Payload.operaciones) || !Payload.operaciones.length) {
    return {
      Ok: false as const,
      Detalle: "operaciones debe contener al menos una accion.",
    };
  }
  if (Payload.operaciones.length > 50) {
    return {
      Ok: false as const,
      Detalle: "El lote admite hasta 50 acciones.",
    };
  }
  const Configuraciones = Object.values(Rutas_B2);
  const Operaciones: Operacion_General_Lote_B2[] = [];
  for (const [Indice, Item] of Payload.operaciones.entries()) {
    if (!Es_Mapa_B2(Item)) {
      return {
        Ok: false as const,
        Detalle: `La accion ${Indice + 1} no es valida.`,
      };
    }
    const Accion = Leer_String_B2(Item, "accion");
    const Config = Configuraciones.find((Actual) =>
      Actual.Accion === Accion
    );
    if (!Config) {
      return {
        Ok: false as const,
        Detalle: `La accion ${Indice + 1} no esta disponible en el lote.`,
      };
    }
    if (!Es_Mapa_B2(Item.payload)) {
      return {
        Ok: false as const,
        Detalle: `La accion ${Indice + 1} necesita un payload valido.`,
      };
    }
    Operaciones.push({ Accion, Payload: Item.payload, Config });
  }
  return { Ok: true as const, Operaciones };
}

function Ejecutar_Operaciones_Generales_Lote_B2(
  Estado: Mapa,
  Operaciones: Operacion_General_Lote_B2[]
) {
  const Resultados: Array<{
    posicion: number;
    accion: string;
    respuesta: string;
    resultado: Mapa;
  }> = [];
  for (const [Indice, Operacion] of Operaciones.entries()) {
    const Resultado = Operacion.Config.Handler(Estado, {
      ...Operacion.Payload,
      confirmar_eliminacion: true,
    });
    if (Resultado.Cambios === false) {
      return {
        Ok: false as const,
        Status: Resultado.Status || 400,
        Error: Resultado.Error || "Cambio no aplicado",
        Detalle: `La accion ${Indice + 1} no se pudo aplicar: ${Resultado.Respuesta}`,
      };
    }
    Resultados.push({
      posicion: Indice + 1,
      accion: Operacion.Accion,
      respuesta: Resultado.Respuesta,
      resultado: Resultado.Resultado || {},
    });
  }
  return { Ok: true as const, Resultados };
}

async function Responder_Lote_Operaciones_B2(
  Req: Request,
  Auth: Extract<Auth_Resultado, { Ok: true }>
) {
  const Payload = await Leer_Body_Json_B2(Req);
  const Operaciones = Resolver_Operaciones_Generales_Lote_B2(Payload);
  if (!Operaciones.Ok) {
    return Responder_Error(400, "Lote invalido", Operaciones.Detalle);
  }
  for (const Operacion of Operaciones.Operaciones) {
    if (!Tiene_Scope(Auth.Scopes, Operacion.Config.Scope)) {
      return Responder_Error(
        403,
        "Scope insuficiente",
        `La accion ${Operacion.Accion} requiere ${Operacion.Config.Scope}.`
      );
    }
  }
  const Fila = await Leer_Estado_Usuario_Completo_B2(Auth.Usuario_Id);
  if (!Fila.Ok) return Responder_Error(Fila.Status, Fila.Error, Fila.Detalle);
  const Vista_Previa = Ejecutar_Operaciones_Generales_Lote_B2(
    Clonar_B2(Fila.Estado),
    Operaciones.Operaciones
  );
  if (!Vista_Previa.Ok) {
    return Responder_Error(
      Vista_Previa.Status,
      Vista_Previa.Error,
      Vista_Previa.Detalle
    );
  }
  if (!Leer_Boolean_B2(Payload, false, "confirmar_aplicacion")) {
    return Responder_Json({
      Ok: true,
      Previsualizacion: true,
      Cantidad: Vista_Previa.Resultados.length,
      Operaciones: Vista_Previa.Resultados.map((Resultado) => ({
        posicion: Resultado.posicion,
        accion: Resultado.accion,
        respuesta: Resultado.respuesta,
      })),
      Instruccion:
        "Repeti el mismo lote con confirmar_aplicacion: true para aplicar todos los cambios.",
    });
  }
  const Scopes = [...new Set(
    Operaciones.Operaciones.map((Operacion) => Operacion.Config.Scope)
  )].join(" ");
  return await Mutar_Estado_B2(
    Auth.Usuario_Id,
    "lote_operaciones",
    Scopes,
    Payload,
    (Estado) => {
      const Aplicacion = Ejecutar_Operaciones_Generales_Lote_B2(
        Estado,
        Operaciones.Operaciones
      );
      if (!Aplicacion.Ok) {
        return {
          Cambios: false,
          Status: Aplicacion.Status,
          Error: Aplicacion.Error,
          Respuesta: Aplicacion.Detalle,
        };
      }
      return {
        Respuesta:
          `Lote aplicado con ${Aplicacion.Resultados.length} acciones.`,
        Resultado: { operaciones: Aplicacion.Resultados },
      };
    }
  );
}

async function Responder_Deshacer_B2(
  Req: Request,
  Auth: Extract<Auth_Resultado, { Ok: true }>
) {
  const Payload = await Leer_Body_Json_B2(Req);
  if (!Leer_Boolean_B2(Payload, false, "confirmar_deshacer")) {
    return Responder_Error(400, "Confirmacion requerida", "El deshacer requiere confirmar_deshacer: true.");
  }
  const Supa = Crear_Supabase_Servicio();
  const Mutacion_Id = Leer_String_B2(Payload, "mutacion_id");
  let Consulta = Supa.from("ia_mutaciones_usuario")
    .select("id, accion, scope, estado_antes")
    .eq("usuario_id", Auth.Usuario_Id)
    .eq("estado", "aplicado")
    .order("creado_en", { ascending: false })
    .limit(1);
  if (Mutacion_Id) Consulta = Supa.from("ia_mutaciones_usuario")
    .select("id, accion, scope, estado_antes")
    .eq("usuario_id", Auth.Usuario_Id)
    .eq("id", Mutacion_Id)
    .eq("estado", "aplicado")
    .limit(1);
  const { data, error } = await Consulta.maybeSingle();
  if (error || !data || !Es_Mapa_B2(data.estado_antes)) {
    return Responder_Error(404, "Mutacion no reversible", "No encontre una mutacion aplicada con estado previo.");
  }
  if (!Tiene_Scopes_B2(Auth.Scopes, data.scope)) {
    return Responder_Error(403, "Scope insuficiente", "El token no puede deshacer esa mutacion.");
  }
  const Respuesta = await Mutar_Estado_B2(
    Auth.Usuario_Id,
    "deshacer",
    String(data.scope),
    Payload,
    (Estado) => {
      Object.keys(Estado).forEach((Clave) => delete Estado[Clave]);
      Object.assign(Estado, Clonar_B2(data.estado_antes as Mapa));
      return { Respuesta: `Se deshizo la mutacion ${data.accion}.`, Resultado: { mutacion_id: data.id } };
    }
  );
  if (Respuesta.status < 300) {
    await Supa.from("ia_mutaciones_usuario")
      .update({ estado: "deshecho" })
      .eq("id", data.id)
      .eq("usuario_id", Auth.Usuario_Id);
  }
  return Respuesta;
}

async function Leer_Estado_Usuario_Completo_B2(
  Usuario_Id: string
): Promise<Estado_Completo_B2> {
  try {
    const Supa_Servicio = Crear_Supabase_Servicio();
    const { data, error } = await Supa_Servicio
      .from("estado_usuario")
      .select("estado, version, actualizado_en")
      .eq("user_id", Usuario_Id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        Ok: false,
        Status: 404,
        Error: "Estado inexistente",
        Detalle: "No existe un estado remoto para el usuario.",
      };
    }
    return {
      Ok: true,
      Estado: Es_Mapa_B2(data.estado) ? data.estado as Mapa : {},
      Version: Number(data.version) || 1,
      Actualizado_En:
        typeof data.actualizado_en === "string"
          ? data.actualizado_en
          : null,
    };
  } catch (Error_General) {
    console.error("Error leyendo estado B2:", Error_General);
    return {
      Ok: false,
      Status: 500,
      Error: "Error interno",
      Detalle: "No se pudo leer el estado completo del usuario.",
    };
  }
}

async function Mutar_Estado_B2(
  Usuario_Id: string,
  Accion: string,
  Scope: string,
  Payload: Mapa,
  Mutador: (Estado: Mapa) => Resultado_Mutacion_B2,
  Intento = 0
) {
  const Idempotency_Key = Obtener_Idempotency_Key_B2(Payload);
  if (Intento === 0 && Idempotency_Key) {
    const Existente = await Leer_Mutacion_Idempotente_B2(
      Usuario_Id,
      Idempotency_Key
    );
    if (Existente) {
      return Responder_Json({
        Ok: true,
        Repetida: true,
        Accion,
        Resultado: Existente.resultado || {},
      });
    }
  }

  const Fila = await Leer_Estado_Usuario_Completo_B2(Usuario_Id);
  if (!Fila.Ok) {
    return Responder_Error(Fila.Status, Fila.Error, Fila.Detalle);
  }

  const Estado_Antes = Clonar_B2(Fila.Estado);
  const Estado = Clonar_B2(Fila.Estado);
  const Resultado = Mutador(Estado);
  if (Resultado.Cambios === false) {
    return Responder_Error(
      Resultado.Status || 400,
      Resultado.Error || "Cambio no aplicado",
      Resultado.Respuesta
    );
  }

  Estado.Sync_Datos_Marca_Ms = Date.now();
  const Supa_Servicio = Crear_Supabase_Servicio();
  const { data, error } = await Supa_Servicio
    .rpc("aplicar_estado_usuario_b2", {
      p_usuario_id: Usuario_Id,
      p_estado: Estado,
      p_version_esperada: Fila.Version,
    })
    .maybeSingle();
  if (error) {
    console.error("Error guardando mutacion B2:", error);
    return Responder_Error(
      500,
      "Error interno",
      "No se pudo guardar la mutacion B2."
    );
  }
  if (!data) {
    if (Intento < 1) {
      return await Mutar_Estado_B2(
        Usuario_Id,
        Accion,
        Scope,
        Payload,
        Mutador,
        Intento + 1
      );
    }
    return Responder_Error(
      409,
      "Conflicto de version",
      "El estado remoto cambio al mismo tiempo. Reintenta."
    );
  }

  const Version_Despues =
    Number((data as { version?: number }).version) || Fila.Version + 1;

  await Registrar_Mutacion_B2({
    Usuario_Id,
    Accion,
    Scope,
    Idempotency_Key,
    Payload,
    Resultado: Resultado.Resultado || {},
    Version_Antes: Fila.Version,
    Version_Despues,
    Estado_Antes,
  });

  return Responder_Json({
    Ok: true,
    Accion,
    Respuesta: Resultado.Respuesta,
    Resultado: Resultado.Resultado || {},
    Version: Version_Despues,
  });
}

async function Leer_Mutacion_Idempotente_B2(
  Usuario_Id: string,
  Idempotency_Key: string
) {
  try {
    const Supa_Servicio = Crear_Supabase_Servicio();
    const { data, error } = await Supa_Servicio
      .from("ia_mutaciones_usuario")
      .select("resultado")
      .eq("usuario_id", Usuario_Id)
      .eq("idempotency_key", Idempotency_Key)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (Error_General) {
    console.error("Error leyendo idempotencia B2:", Error_General);
    return null;
  }
}

async function Registrar_Mutacion_B2(
  Datos: {
    Usuario_Id: string;
    Accion: string;
    Scope: string;
    Idempotency_Key: string;
    Payload: Mapa;
    Resultado: Mapa;
    Version_Antes: number;
    Version_Despues: number;
    Estado_Antes: Mapa;
  }
) {
  try {
    const Supa_Servicio = Crear_Supabase_Servicio();
    const { error } = await Supa_Servicio
      .from("ia_mutaciones_usuario")
      .insert({
        usuario_id: Datos.Usuario_Id,
        origen: "chatgpt",
        accion: Datos.Accion,
        scope: Datos.Scope,
        idempotency_key: Datos.Idempotency_Key || null,
        payload: Datos.Payload,
        resultado: Datos.Resultado,
        estado: "aplicado",
        version_antes: Datos.Version_Antes,
        version_despues: Datos.Version_Despues,
        estado_antes: Datos.Estado_Antes,
      });
    if (error) throw error;
  } catch (Error_General) {
    console.error("Error registrando auditoria B2:", Error_General);
  }
}

async function Responder_Historial_Chat(
  Usuario_Id: string,
  Url: URL
) {
  try {
    const Limite = Resolver_Limite(Url, 20, 50);
    const Supa = Crear_Supabase_Servicio();
    const { data, error } = await Supa
      .from("ia_mutaciones_usuario")
      .select("id, accion, scope, resultado, estado, version_antes, version_despues, creado_en")
      .eq("usuario_id", Usuario_Id)
      .order("creado_en", { ascending: false })
      .limit(Limite);
    if (error) throw error;
    return Responder_Json({ Ok: true, Mutaciones: data || [] });
  } catch (Error_General) {
    console.error("Error leyendo historial del chat:", Error_General);
    return Responder_Error(500, "Error interno", "No se pudo leer el historial del chat.");
  }
}

function B2_Crear_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Nombre = Leer_String_B2(Payload, "nombre", "Nombre");
  if (!Nombre) return Error_Mutacion_B2("La tarea necesita nombre.");
  const Fecha = Resolver_Fecha_Relativa_B2(Payload, "");
  const Hora = Leer_Hora_B2(Payload, "hora", "Hora", "");
  const Cajon = Leer_String_B2(Payload, "cajon", "Cajon") ||
    "Inbox";
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Ahora = new Date().toISOString();
  const Tarea = {
    Tipo_Dato: "Tarea",
    Id: Crear_Id_B2("Tarea"),
    Emoji: Leer_String_B2(Payload, "emoji", "Emoji") || "\u2022",
    Nombre,
    Descripcion: Leer_String_B2(Payload, "descripcion", "Descripcion"),
    Cajon,
    Prioridad:
      Leer_String_B2(Payload, "prioridad", "Prioridad") || "baja",
    Etiquetas: Leer_Array_String_B2(Payload, "etiquetas", "Etiquetas"),
    Fecha_Limite: Leer_Fecha_B2(Payload, "fecha_limite", "Fecha_Limite", ""),
    Repeticion: Es_Mapa_B2(Payload.repeticion) ? Payload.repeticion : { Tipo: "ninguna" },
    Subtareas: Array.isArray(Payload.subtareas) ? Payload.subtareas : [],
    Adjuntos: Leer_Array_String_B2(Payload, "adjuntos", "Adjuntos"),
    Dependencias_Ids: Leer_Array_String_B2(Payload, "dependencias_ids", "Dependencias_Ids"),
    Estimacion_Minutos: Math.max(0, Leer_Numero_B2(Payload, "estimacion_minutos") || 0),
    Tiempo_Registrado_Minutos: 0,
    Motivo_Posposicion: "",
    Fecha_Sugerida: "",
    Archivada: false,
    Historial: [{ Fecha: Ahora, Tipo: "creada", Detalle: "ChatGPT" }],
    Estado: "pendiente",
    Fecha,
    Hora,
    Planeada: false,
    Evento_Id: "",
    Abordaje_Id: "",
    Plan_Clave: "",
    Plan_Item_Id: "",
    Fecha_Creacion: Ahora,
    Fecha_Actualizacion: Ahora,
    Fecha_Completado: "",
  };
  Tareas.push(Tarea);
  Asegurar_Cajon_Tareas_B2(Estado, Cajon);
  if (Fecha && Hora) {
    Planificar_Tarea_B2(Estado, Tarea);
  }
  return {
    Respuesta: `Tarea creada: ${Nombre}.`,
    Resultado: { tarea_id: Tarea.Id },
  };
}

function B2_Marcar_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Busqueda = Buscar_Item_B2(
    Tareas,
    Payload,
    "tarea_id",
    "Nombre"
  );
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Tarea = Busqueda.Item;
  const Hecha = Leer_Boolean_B2(Payload, true, "hecha", "Hecha");
  const Estado_Nuevo = Hecha ? "completada" : "pendiente";
  const Ahora = new Date().toISOString();
  Tarea.Estado = Estado_Nuevo;
  Tarea.Fecha_Actualizacion = Ahora;
  Tarea.Fecha_Completado = Hecha ? Ahora : "";
  Sincronizar_Estado_Tarea_Vinculada_B2(Estado, Tarea);
  return {
    Respuesta: Hecha
      ? `Tarea marcada como hecha: ${Tarea.Nombre}.`
      : `Tarea marcada como pendiente: ${Tarea.Nombre}.`,
    Resultado: { tarea_id: Tarea.Id, estado: Estado_Nuevo },
  };
}

function B2_Reprogramar_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Busqueda = Buscar_Item_B2(
    Tareas,
    Payload,
    "tarea_id",
    "Nombre"
  );
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Tarea = Busqueda.Item;
  const Sin_Horario = Leer_Boolean_B2(
    Payload,
    false,
    "sin_horario",
    "Sin_Horario"
  );
  const Fecha = Resolver_Fecha_Relativa_B2(
    Payload,
    String(Tarea.Fecha || "") || Fecha_Argentina_B2()
  );
  if (!Fecha) {
    return Error_Mutacion_B2("La fecha o fecha_relativa no es valida.");
  }
  const Hora = Sin_Horario
    ? ""
    : Leer_Hora_B2(Payload, "hora", "Hora", "");
  if (!Sin_Horario && !Hora) {
    return Error_Mutacion_B2("Necesito una hora para reprogramar.");
  }
  Desplanificar_Tarea_B2(Estado, Tarea);
  Tarea.Fecha = Sin_Horario ? "" : Fecha;
  Tarea.Hora = Hora;
  if (!Sin_Horario) {
    Planificar_Tarea_B2(Estado, Tarea);
  }
  Tarea.Fecha_Actualizacion = new Date().toISOString();
  return {
    Respuesta: Sin_Horario
      ? `Horario quitado de tarea: ${Tarea.Nombre}.`
      : `Tarea reprogramada: ${Tarea.Nombre} ${Fecha} ${Hora}.`,
    Resultado: { tarea_id: Tarea.Id, fecha: Tarea.Fecha, hora: Hora },
  };
}

function B2_Editar_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Busqueda = Buscar_Item_B2(
    Tareas,
    Payload,
    "tarea_id",
    "Nombre"
  );
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Tarea = Busqueda.Item;
  const Requiere_Reprogramar =
    Tiene_Campo_B2(Payload, "fecha") ||
    Tiene_Campo_B2(Payload, "fecha_relativa") ||
    Tiene_Campo_B2(Payload, "hora") ||
    Tiene_Campo_B2(Payload, "sin_horario");
  if (Requiere_Reprogramar) {
    const Reprogramacion = B2_Reprogramar_Tarea(Estado, {
      ...Payload,
      tarea_id: Tarea.Id,
    });
    if (Reprogramacion.Cambios === false) {
      return Reprogramacion;
    }
  }

  let Cambios = Requiere_Reprogramar;
  if (Tiene_Campo_B2(Payload, "nuevo_nombre")) {
    const Nombre = Leer_String_B2(Payload, "nuevo_nombre");
    if (!Nombre) return Error_Mutacion_B2("El nombre no puede quedar vacio.");
    Tarea.Nombre = Nombre;
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "emoji")) {
    Tarea.Emoji = Leer_String_B2(Payload, "emoji") || "\u2022";
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "cajon")) {
    const Cajon = Leer_String_B2(Payload, "cajon");
    if (!Cajon) return Error_Mutacion_B2("El cajon no puede quedar vacio.");
    Tarea.Cajon = Cajon;
    Asegurar_Cajon_Tareas_B2(Estado, Cajon);
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "prioridad")) {
    Tarea.Prioridad = Leer_String_B2(Payload, "prioridad") || "baja";
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "descripcion")) {
    Tarea.Descripcion = Leer_String_B2(Payload, "descripcion");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "etiquetas")) {
    Tarea.Etiquetas = Leer_Array_String_B2(Payload, "etiquetas");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "fecha_limite")) {
    Tarea.Fecha_Limite = Leer_Fecha_B2(Payload, "fecha_limite", "Fecha_Limite", "");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "repeticion") && Es_Mapa_B2(Payload.repeticion)) {
    Tarea.Repeticion = Payload.repeticion;
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "subtareas") && Array.isArray(Payload.subtareas)) {
    Tarea.Subtareas = Payload.subtareas;
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "adjuntos")) {
    Tarea.Adjuntos = Leer_Array_String_B2(Payload, "adjuntos");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "dependencias_ids")) {
    Tarea.Dependencias_Ids = Leer_Array_String_B2(Payload, "dependencias_ids");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "estimacion_minutos")) {
    Tarea.Estimacion_Minutos = Math.max(0, Leer_Numero_B2(Payload, "estimacion_minutos") || 0);
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "tiempo_registrado_minutos")) {
    Tarea.Tiempo_Registrado_Minutos = Math.max(0, Leer_Numero_B2(Payload, "tiempo_registrado_minutos") || 0);
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "motivo_posposicion")) {
    Tarea.Motivo_Posposicion = Leer_String_B2(Payload, "motivo_posposicion");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "fecha_sugerida")) {
    Tarea.Fecha_Sugerida = Leer_Fecha_B2(Payload, "fecha_sugerida", "Fecha_Sugerida", "");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "archivada")) {
    Tarea.Archivada = Leer_Boolean_B2(Payload, false, "archivada");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "estado")) {
    const Estado_Nuevo = Leer_String_B2(Payload, "estado").toLowerCase();
    if (![
      "pendiente",
      "completada",
      "pospuesta",
      "cancelada",
    ].includes(Estado_Nuevo)) {
      return Error_Mutacion_B2("El estado de tarea no es valido.");
    }
    Tarea.Estado = Estado_Nuevo;
    Tarea.Fecha_Completado = Estado_Nuevo === "completada"
      ? new Date().toISOString()
      : "";
    if (Estado_Nuevo === "pospuesta") {
      Desplanificar_Tarea_B2(Estado, Tarea);
      Tarea.Fecha = "";
      Tarea.Hora = "";
    } else if (Estado_Nuevo === "cancelada") {
      Desplanificar_Tarea_B2(Estado, Tarea);
    } else {
      Sincronizar_Estado_Tarea_Vinculada_B2(Estado, Tarea);
    }
    Cambios = true;
  }
  if (!Cambios) {
    return Error_Mutacion_B2("No hay cambios para aplicar a la tarea.");
  }
  Sincronizar_Estado_Tarea_Vinculada_B2(Estado, Tarea);
  Tarea.Fecha_Actualizacion = new Date().toISOString();
  return {
    Respuesta: `Tarea actualizada: ${Tarea.Nombre}.`,
    Resultado: { tarea_id: Tarea.Id },
  };
}

function B2_Borrar_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  if (!Leer_Boolean_B2(Payload, false, "confirmar_eliminacion")) {
    return Error_Mutacion_B2(
      "El borrado requiere confirmar_eliminacion: true."
    );
  }
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Busqueda = Buscar_Item_B2(
    Tareas,
    Payload,
    "tarea_id",
    "Nombre"
  );
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Tarea = Busqueda.Item;
  Desplanificar_Tarea_B2(Estado, Tarea);
  const Indice = Tareas.indexOf(Tarea);
  if (Indice >= 0) Tareas.splice(Indice, 1);
  return {
    Respuesta: `Tarea eliminada: ${Tarea.Nombre}.`,
    Resultado: { tarea_id: Tarea.Id },
  };
}

function B2_Duplicar_Tarea(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Tareas = Asegurar_Array_B2(Estado, "Tareas");
  const Busqueda = Buscar_Item_B2(Tareas, Payload, "tarea_id", "Nombre");
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Original = Busqueda.Item;
  const Id = Crear_Id_B2("Tarea");
  const Copia = Clonar_B2(Original);
  Copia.Id = Id;
  Copia.Nombre = Leer_String_B2(Payload, "nuevo_nombre") ||
    `${String(Original.Nombre || "Tarea")} (copia)`;
  Copia.Estado = "pendiente";
  Copia.Fecha_Completado = "";
  Copia.Fecha = Leer_Fecha_B2(Payload, "fecha", "Fecha", String(Original.Fecha || ""));
  Copia.Planeada = false;
  Copia.Evento_Id = "";
  Copia.Abordaje_Id = "";
  Copia.Plan_Clave = "";
  Copia.Plan_Item_Id = "";
  Copia.Archivada = false;
  Copia.Historial = [{
    Fecha: new Date().toISOString(),
    Tipo: "duplicada",
    Detalle: `Origen: ${String(Original.Id || "")}`,
  }];
  Tareas.push(Copia);
  return {
    Respuesta: `Tarea duplicada: ${Copia.Nombre}.`,
    Resultado: { tarea_id: Id, origen_tarea_id: Original.Id },
  };
}

function B2_Crear_Habito(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Nombre = Leer_String_B2(Payload, "nombre", "Nombre");
  if (!Nombre) return Error_Mutacion_B2("El habito necesita nombre.");
  const Habitos = Asegurar_Array_B2(Estado, "Habitos");
  const Habito = {
    Id: Crear_Id_B2("Habito"),
    Nombre,
    Emoji: Leer_String_B2(Payload, "emoji", "Emoji") || "\u2022",
    Color: Leer_String_B2(Payload, "color", "Color") || "#426f94",
    Activo: true,
    Archivado: false,
    Fecha_Inicio: Fecha_Argentina_B2(),
    Tipo: Leer_String_B2(Payload, "tipo", "Tipo") || "Hacer",
    Programacion: {
      Tipo: "Libre",
      Dias: [],
      Horas: [],
      Desde: 0,
      Hasta: 0,
    },
    Meta: {
      Modo: "Check",
      Regla: "Al_Menos",
      Periodo: "Dia",
      Cantidad:
        Leer_Numero_B2(Payload, "cantidad", "Cantidad") || 1,
      Cantidad_Maxima: 1,
      Unidad: Leer_String_B2(Payload, "unidad", "Unidad"),
    },
    Orden: Habitos.length,
    Orden_Manual: false,
  };
  Habitos.push(Habito);
  return {
    Respuesta: `Habito creado: ${Nombre}.`,
    Resultado: { habito_id: Habito.Id },
  };
}

function B2_Registrar_Habito(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Habitos = Asegurar_Array_B2(Estado, "Habitos");
  const Registros = Asegurar_Array_B2(Estado, "Habitos_Registros");
  const Busqueda = Buscar_Item_B2(
    Habitos,
    Payload,
    "habito_id",
    "Nombre"
  );
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Habito = Busqueda.Item;
  const Fecha = Leer_Fecha_B2(
    Payload,
    "fecha",
    "Fecha",
    Fecha_Argentina_B2()
  );
  const Hora = Hora_Argentina_B2();
  const Periodo_Clave = Habito_Clave_Periodo_B2(Habito, Fecha);
  const Cantidad_Base =
    Leer_Numero_B2(Payload, "cantidad", "Cantidad") ??
    Numero_Desde_Mapa_B2(Habito.Meta, "Cantidad", 1);
  const Cantidad = String(Habito.Tipo || "") === "Evitar"
    ? 0
    : Math.max(0, Cantidad_Base);
  const Fuente = "ChatGPT";
  const Fuente_Id = Crear_Id_B2("ChatGPT_Habito");
  Registros.push({
    Id: Crear_Id_B2("Habito_Reg"),
    Habito_Id: String(Habito.Id || ""),
    Fecha,
    Hora,
    Fecha_Hora: `${Fecha}T${Hora}`,
    Periodo_Clave,
    Fuente,
    Fuente_Id,
    Cantidad,
    Unidad: Habito_Unidad_B2(Habito),
    Nota: Leer_String_B2(Payload, "nota", "Nota") || "ChatGPT",
    Skip: false,
  });
  return {
    Respuesta: `Habito registrado: ${Habito.Nombre} (${Fecha}).`,
    Resultado: { habito_id: Habito.Id, fecha: Fecha },
  };
}

function B2_Registrar_Avance_Meta(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Nombre = Leer_String_B2(
    Payload,
    "busqueda",
    "nombre",
    "Nombre"
  );
  const Cantidad = Leer_Numero_B2(Payload, "cantidad", "Cantidad") || 0;
  if (!Nombre || Cantidad <= 0) {
    return Error_Mutacion_B2(
      "El avance necesita nombre de meta y cantidad positiva."
    );
  }
  const Modelo = Obtener_Modelo_Planes_B2(Estado);
  if (!Modelo) return Error_Mutacion_B2("No encontre Planes_Periodo.");
  const Busqueda = Buscar_Item_Meta_B2(Modelo, Nombre);
  if (Busqueda.Ok !== true) return Busqueda.Respuesta;
  const Item = Busqueda.Item;
  const Id = Crear_Id_B2("Plan_Avance");
  const Fecha = Leer_Fecha_B2(
    Payload,
    "fecha",
    "Fecha",
    Fecha_Argentina_B2()
  );
  const Hora = Leer_Hora_B2(
    Payload,
    "hora",
    "Hora",
    Hora_Argentina_B2()
  );
  const Avances = Modelo.Avances as Mapa;
  Avances[Id] = {
    Id,
    Objetivo_Id: String(Item.Objetivo_Id || ""),
    Subobjetivo_Id: String(Item.Subobjetivo_Id || ""),
    Parte_Id: String(Item.Parte_Id || ""),
    Fuente: Item.Tipo === "Objetivo" ? "Manual" : "Subobjetivo",
    Cantidad,
    Cantidad_Total: 0,
    Unidad:
      Leer_String_B2(Payload, "unidad", "Unidad") ||
      String(Item.Unidad || ""),
    Fecha,
    Hora,
    Fecha_Hora: `${Fecha}T${Hora || "00:00"}`,
    Nota: Leer_String_B2(Payload, "nota", "Nota") || "ChatGPT",
    Origen_Tipo: "ChatGPT",
    Origen_Id: Id,
    Origen_Objetivo_Semanal_Id: "",
    Origen_Subobjetivo_Semanal_Id: "",
    Automatico: false,
    Distribucion: [],
    Orden: Object.keys(Avances).length,
    Creado_En: new Date().toISOString(),
    Actualizado_En: new Date().toISOString(),
  };
  Estado.Planes_Periodo = Modelo;
  return {
    Respuesta: `Avance de meta registrado: ${Item.Nombre}.`,
    Resultado: { avance_id: Id },
  };
}

function Tiene_Campo_B2(Payload: Mapa, ...Campos: string[]) {
  return Campos.some((Campo) =>
    Object.prototype.hasOwnProperty.call(Payload, Campo)
  );
}

function Aplicar_Texto_Plan_B2(
  Destino: Mapa,
  Payload: Mapa,
  Campo: string,
  Campo_Destino = Campo
) {
  if (!Tiene_Campo_B2(Payload, Campo)) return false;
  Destino[Campo_Destino] = String(Payload[Campo] || "").trim();
  return true;
}

function Aplicar_Numero_Plan_B2(
  Destino: Mapa,
  Payload: Mapa,
  Campo: string,
  Campo_Destino = Campo
) {
  if (!Tiene_Campo_B2(Payload, Campo)) return false;
  const Valor = Number(Payload[Campo]);
  if (!Number.isFinite(Valor) || Valor < 0) return false;
  Destino[Campo_Destino] = Valor;
  return true;
}

function Aplicar_Fecha_Plan_B2(
  Destino: Mapa,
  Payload: Mapa,
  Campo: string,
  Campo_Destino = Campo
) {
  if (!Tiene_Campo_B2(Payload, Campo)) return false;
  const Fecha = String(Payload[Campo] || "").trim();
  if (Fecha && !Es_Fecha_ISO_Valida(Fecha)) return false;
  Destino[Campo_Destino] = Fecha;
  return true;
}

function Normalizar_Metadatos_Plan_B2(Valor: unknown): Mapa {
  if (!Es_Mapa_B2(Valor)) return {};
  const Resultado: Mapa = {};
  Object.entries(Valor as Mapa).forEach(([Clave, Dato]) => {
    const Nombre = String(Clave || "").trim();
    if (!Nombre) return;
    Resultado[Nombre] = String(Dato ?? "").trim();
  });
  return Resultado;
}

function Normalizar_Campos_Metadatos_Plan_B2(
  Valor: unknown
) {
  if (!Array.isArray(Valor)) return [];
  const Nombres = new Set<string>();
  return Valor.flatMap((Item, Indice) => {
    if (!Es_Mapa_B2(Item)) return [];
    const Base = Item as Mapa;
    const Nombre = String(
      Base.nombre || Base.Nombre || ""
    ).trim();
    if (!Nombre) return [];
    const Clave = Normalizar_Texto_Busqueda(Nombre);
    if (Nombres.has(Clave)) return [];
    Nombres.add(Clave);
    return [{
      Id: String(Base.id || Base.Id ||
        `Meta_${Date.now()}_${Indice}`).trim(),
      Nombre,
      Tipo: ["Numerico", "numerico", "numero"]
        .includes(String(Base.tipo || Base.Tipo || ""))
        ? "Numerico"
        : "String",
    }];
  });
}

function Obtener_Operacion_Plan_B2(Payload: Mapa) {
  const Operacion = Leer_String_B2(Payload, "operacion")
    .toLowerCase();
  return ["crear", "editar", "borrar"].includes(Operacion)
    ? Operacion
    : "";
}

function Confirmar_Eliminacion_Plan_B2(Payload: Mapa) {
  return Leer_Boolean_B2(
    Payload,
    false,
    "confirmar_eliminacion"
  );
}

function Obtener_Item_Plan_B2(
  Items: Mapa,
  Id: string,
  Tipo: string
): Mapa | null {
  const Item = Items[Id];
  if (!Es_Mapa_B2(Item)) return null;
  return Item as Mapa;
}

function Actualizar_Marca_Plan_B2(Item: Mapa) {
  Item.Actualizado_En = new Date().toISOString();
}

function B2_Mutar_Objetivo_Plan(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Operacion = Obtener_Operacion_Plan_B2(Payload);
  if (!Operacion) return Error_Mutacion_B2("Operacion invalida.");
  const Modelo = Obtener_Modelo_Planes_B2(Estado);
  if (!Modelo) return Error_Mutacion_B2("No encontre Planes_Periodo.");
  const Periodos = Modelo.Periodos as Mapa;
  const Objetivos = Modelo.Objetivos as Mapa;
  if (Operacion === "crear") {
    const Periodo_Id = Leer_String_B2(Payload, "periodo_id");
    const Nombre = Leer_String_B2(Payload, "nombre");
    if (!Periodo_Id || !Obtener_Item_Plan_B2(Periodos, Periodo_Id, "Periodo")) {
      return Error_Mutacion_B2("Necesito un periodo_id valido.");
    }
    if (!Nombre) return Error_Mutacion_B2("El objetivo necesita nombre.");
    const Objetivo_Padre_Id = Leer_String_B2(
      Payload,
      "objetivo_padre_id"
    );
    if (
      Objetivo_Padre_Id &&
      !Obtener_Item_Plan_B2(Objetivos, Objetivo_Padre_Id, "Objetivo")
    ) {
      return Error_Mutacion_B2("objetivo_padre_id no existe.");
    }
    const Id = Crear_Id_B2("Plan_Obj");
    const Ahora = new Date().toISOString();
    Objetivos[Id] = {
      Id,
      Periodo_Id,
      Objetivo_Padre_Id: Objetivo_Padre_Id || null,
      Nombre,
      Descripcion: Leer_String_B2(Payload, "descripcion"),
      Emoji: Leer_String_B2(Payload, "emoji") || "\u2705",
      Color: Leer_String_B2(Payload, "color"),
      Target_Total: Math.max(0, Leer_Numero_B2(Payload, "target_total") || 0),
      Target_Actual: Math.max(0, Leer_Numero_B2(Payload, "target_total") || 0),
      Unidad: Leer_String_B2(Payload, "unidad") || "Horas",
      Unidad_Custom: Leer_String_B2(Payload, "unidad_custom"),
      Modo_Progreso: Leer_String_B2(Payload, "modo_progreso") || "Hibrido",
      Modo_Avance: "Metrica",
      Etiquetas_Ids: Leer_Array_String_B2(Payload, "etiquetas_ids"),
      Tags: Leer_Array_String_B2(Payload, "tags"),
      Metadatos_Campos: Normalizar_Campos_Metadatos_Plan_B2(
        Payload.metadatos_campos
      ),
      Metadatos_Campos_Config: Tiene_Campo_B2(
        Payload,
        "metadatos_campos"
      ),
      Estado: "Activo",
      Eliminado_Local: false,
      Orden: Object.keys(Objetivos).length,
      Creado_En: Ahora,
      Actualizado_En: Ahora,
    };
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: `Objetivo creado: ${Nombre}.`,
      Resultado: { objetivo_id: Id },
    };
  }

  const Id = Leer_String_B2(Payload, "objetivo_id");
  const Objetivo = Obtener_Item_Plan_B2(Objetivos, Id, "Objetivo");
  if (!Objetivo) return Error_Mutacion_B2("objetivo_id no existe.");
  if (Operacion === "borrar") {
    if (!Confirmar_Eliminacion_Plan_B2(Payload)) {
      return Error_Mutacion_B2(
        "El borrado requiere confirmar_eliminacion: true."
      );
    }
    const Alcance = Leer_String_B2(
      Payload,
      "alcance_eliminacion"
    ) || "solo";
    const Afectados = new Set([Id]);
    if (Alcance === "hijos" || Alcance === "todos") {
      Object.values(Objetivos).forEach((Item) => {
        if (!Es_Mapa_B2(Item)) return;
        const Hijo = Item as Mapa;
        if (String(Hijo.Objetivo_Padre_Id || "") === Id) {
          Afectados.add(String(Hijo.Id || ""));
        }
      });
    }
    if (Alcance === "todos") {
      let Cambio = true;
      while (Cambio) {
        Cambio = false;
        Object.values(Objetivos).forEach((Item) => {
          if (!Es_Mapa_B2(Item)) return;
          const Hijo = Item as Mapa;
          const Hijo_Id = String(Hijo.Id || "");
          if (
            Afectados.has(String(Hijo.Objetivo_Padre_Id || "")) &&
            !Afectados.has(Hijo_Id)
          ) {
            Afectados.add(Hijo_Id);
            Cambio = true;
          }
        });
      }
    }
    Afectados.forEach((Objetivo_Id) => {
      const Item = Obtener_Item_Plan_B2(Objetivos, Objetivo_Id, "Objetivo");
      if (!Item) return;
      Item.Eliminado_Local = true;
      Actualizar_Marca_Plan_B2(Item);
    });
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: "Objetivo archivado logicamente.",
      Resultado: { objetivo_id: Id, afectados: Afectados.size },
    };
  }

  let Cambios = false;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "nombre", "Nombre") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "descripcion", "Descripcion") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "emoji", "Emoji") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "color", "Color") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "unidad", "Unidad") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "unidad_custom", "Unidad_Custom") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Objetivo, Payload, "modo_progreso", "Modo_Progreso") || Cambios;
  Cambios = Aplicar_Numero_Plan_B2(Objetivo, Payload, "target_total", "Target_Total") || Cambios;
  if (Tiene_Campo_B2(Payload, "etiquetas_ids")) {
    Objetivo.Etiquetas_Ids = Leer_Array_String_B2(Payload, "etiquetas_ids");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "tags")) {
    Objetivo.Tags = Leer_Array_String_B2(Payload, "tags");
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "metadatos_campos")) {
    Objetivo.Metadatos_Campos = Normalizar_Campos_Metadatos_Plan_B2(
      Payload.metadatos_campos
    );
    Objetivo.Metadatos_Campos_Config = true;
    Cambios = true;
  }
  if (!Cambios || !String(Objetivo.Nombre || "").trim()) {
    return Error_Mutacion_B2("No hay cambios validos para el objetivo.");
  }
  Actualizar_Marca_Plan_B2(Objetivo);
  Estado.Planes_Periodo = Modelo;
  return {
    Respuesta: `Objetivo actualizado: ${Objetivo.Nombre}.`,
    Resultado: { objetivo_id: Id },
  };
}

function B2_Mutar_Subobjetivo_Plan(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Operacion = Obtener_Operacion_Plan_B2(Payload);
  if (!Operacion) return Error_Mutacion_B2("Operacion invalida.");
  const Modelo = Obtener_Modelo_Planes_B2(Estado);
  if (!Modelo) return Error_Mutacion_B2("No encontre Planes_Periodo.");
  const Objetivos = Modelo.Objetivos as Mapa;
  const Subobjetivos = Modelo.Subobjetivos as Mapa;
  if (Operacion === "crear") {
    const Objetivo_Id = Leer_String_B2(Payload, "objetivo_id");
    const Objetivo = Obtener_Item_Plan_B2(Objetivos, Objetivo_Id, "Objetivo");
    const Texto = Leer_String_B2(Payload, "texto");
    if (!Objetivo || Objetivo.Eliminado_Local === true) {
      return Error_Mutacion_B2("Necesito un objetivo_id activo.");
    }
    if (!Texto) return Error_Mutacion_B2("El subobjetivo necesita texto.");
    const Padre_Id = Leer_String_B2(Payload, "subobjetivo_padre_id");
    const Padre = Padre_Id
      ? Obtener_Item_Plan_B2(Subobjetivos, Padre_Id, "Subobjetivo")
      : null;
    if (Padre_Id && (!Padre || Padre.Objetivo_Id !== Objetivo_Id)) {
      return Error_Mutacion_B2("subobjetivo_padre_id no corresponde al objetivo.");
    }
    const Id = Crear_Id_B2("Plan_Sub");
    const Ahora = new Date().toISOString();
    Subobjetivos[Id] = {
      Id,
      Objetivo_Id,
      Parent_Subobjetivo_Id: Padre_Id || "",
      Subobjetivo_Padre_Id: Padre_Id || "",
      Emoji: Leer_String_B2(Payload, "emoji") || "\u2022",
      Texto,
      Target_Total: Math.max(0, Leer_Numero_B2(Payload, "target_total") || 0),
      Aporte_Meta: Math.max(0, Leer_Numero_B2(Payload, "aporte_meta") || 0),
      Unidad: Leer_String_B2(Payload, "unidad") ||
        String(Objetivo.Unidad_Subobjetivos_Default || Objetivo.Unidad || "Horas"),
      Unidad_Custom: Leer_String_B2(Payload, "unidad_custom"),
      Fecha_Inicio: Leer_Fecha_B2(Payload, "fecha_inicio", "fecha_inicio", ""),
      Fecha_Objetivo: Leer_Fecha_B2(Payload, "fecha_objetivo", "fecha_objetivo", ""),
      Metadatos: Normalizar_Metadatos_Plan_B2(Payload.metadatos),
      Estado: "Activo",
      Hecha: false,
      Eliminado_Local: false,
      Orden: Object.keys(Subobjetivos).length,
      Creado_En: Ahora,
      Actualizado_En: Ahora,
    };
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: `Subobjetivo creado: ${Texto}.`,
      Resultado: { subobjetivo_id: Id, objetivo_id: Objetivo_Id },
    };
  }

  const Id = Leer_String_B2(Payload, "subobjetivo_id");
  const Subobjetivo = Obtener_Item_Plan_B2(Subobjetivos, Id, "Subobjetivo");
  if (!Subobjetivo) return Error_Mutacion_B2("subobjetivo_id no existe.");
  if (Operacion === "borrar") {
    if (!Confirmar_Eliminacion_Plan_B2(Payload)) {
      return Error_Mutacion_B2(
        "El borrado requiere confirmar_eliminacion: true."
      );
    }
    const Afectados = new Set([Id]);
    let Cambio = true;
    while (Cambio) {
      Cambio = false;
      Object.values(Subobjetivos).forEach((Item) => {
        if (!Es_Mapa_B2(Item)) return;
        const Hijo = Item as Mapa;
        const Padre = String(
          Hijo.Subobjetivo_Padre_Id ||
            Hijo.Parent_Subobjetivo_Id || ""
        );
        const Hijo_Id = String(Hijo.Id || "");
        if (Afectados.has(Padre) && !Afectados.has(Hijo_Id)) {
          Afectados.add(Hijo_Id);
          Cambio = true;
        }
      });
    }
    Afectados.forEach((Subobjetivo_Id) => {
      const Item = Obtener_Item_Plan_B2(Subobjetivos, Subobjetivo_Id, "Subobjetivo");
      if (!Item) return;
      Item.Eliminado_Local = true;
      Actualizar_Marca_Plan_B2(Item);
    });
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: "Subobjetivo archivado logicamente.",
      Resultado: { subobjetivo_id: Id, afectados: Afectados.size },
    };
  }

  let Cambios = false;
  Cambios = Aplicar_Texto_Plan_B2(Subobjetivo, Payload, "texto", "Texto") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Subobjetivo, Payload, "emoji", "Emoji") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Subobjetivo, Payload, "unidad", "Unidad") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Subobjetivo, Payload, "unidad_custom", "Unidad_Custom") || Cambios;
  Cambios = Aplicar_Numero_Plan_B2(Subobjetivo, Payload, "target_total", "Target_Total") || Cambios;
  Cambios = Aplicar_Numero_Plan_B2(Subobjetivo, Payload, "aporte_meta", "Aporte_Meta") || Cambios;
  Cambios = Aplicar_Fecha_Plan_B2(Subobjetivo, Payload, "fecha_inicio", "Fecha_Inicio") || Cambios;
  Cambios = Aplicar_Fecha_Plan_B2(Subobjetivo, Payload, "fecha_objetivo", "Fecha_Objetivo") || Cambios;
  if (Tiene_Campo_B2(Payload, "metadatos")) {
    Subobjetivo.Metadatos = Normalizar_Metadatos_Plan_B2(Payload.metadatos);
    Cambios = true;
  }
  if (!Cambios || !String(Subobjetivo.Texto || "").trim()) {
    return Error_Mutacion_B2("No hay cambios validos para el subobjetivo.");
  }
  Actualizar_Marca_Plan_B2(Subobjetivo);
  Estado.Planes_Periodo = Modelo;
  return {
    Respuesta: `Subobjetivo actualizado: ${Subobjetivo.Texto}.`,
    Resultado: { subobjetivo_id: Id },
  };
}

function B2_Mutar_Parte_Plan(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Operacion = Obtener_Operacion_Plan_B2(Payload);
  if (!Operacion) return Error_Mutacion_B2("Operacion invalida.");
  const Modelo = Obtener_Modelo_Planes_B2(Estado);
  if (!Modelo) return Error_Mutacion_B2("No encontre Planes_Periodo.");
  const Subobjetivos = Modelo.Subobjetivos as Mapa;
  const Partes = Modelo.Partes as Mapa;
  const Avances = Modelo.Avances as Mapa;
  if (Operacion === "crear") {
    const Subobjetivo_Id = Leer_String_B2(Payload, "subobjetivo_id");
    const Subobjetivo = Obtener_Item_Plan_B2(Subobjetivos, Subobjetivo_Id, "Subobjetivo");
    const Nombre = Leer_String_B2(Payload, "nombre");
    if (!Subobjetivo || Subobjetivo.Eliminado_Local === true) {
      return Error_Mutacion_B2("Necesito un subobjetivo_id activo.");
    }
    if (!Nombre) return Error_Mutacion_B2("La parte necesita nombre.");
    const Id = Crear_Id_B2("Plan_Parte");
    const Ahora = new Date().toISOString();
    Partes[Id] = {
      Id,
      Objetivo_Id: String(Subobjetivo.Objetivo_Id || ""),
      Subobjetivo_Id,
      Emoji: Leer_String_B2(Payload, "emoji") || "\u2022",
      Nombre,
      Aporte_Total: Math.max(0, Leer_Numero_B2(Payload, "aporte_total") || 0),
      Unidad: Leer_String_B2(Payload, "unidad") || String(Subobjetivo.Unidad || ""),
      Unidad_Custom: Leer_String_B2(Payload, "unidad_custom"),
      Fecha_Inicio: Leer_Fecha_B2(Payload, "fecha_inicio", "fecha_inicio", ""),
      Fecha_Objetivo: Leer_Fecha_B2(Payload, "fecha_objetivo", "fecha_objetivo", ""),
      Metadatos: Normalizar_Metadatos_Plan_B2(Payload.metadatos),
      Estado: "Pendiente",
      Eliminado_Local: false,
      Orden: Object.keys(Partes).length,
      Creado_En: Ahora,
      Actualizado_En: Ahora,
    };
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: `Parte creada: ${Nombre}.`,
      Resultado: { parte_id: Id, subobjetivo_id: Subobjetivo_Id },
    };
  }

  const Id = Leer_String_B2(Payload, "parte_id");
  const Parte = Obtener_Item_Plan_B2(Partes, Id, "Parte");
  if (!Parte) return Error_Mutacion_B2("parte_id no existe.");
  if (Operacion === "borrar") {
    if (!Confirmar_Eliminacion_Plan_B2(Payload)) {
      return Error_Mutacion_B2(
        "El borrado requiere confirmar_eliminacion: true."
      );
    }
    const Tiene_Avances = Object.values(Avances).some((Avance) =>
      Es_Mapa_B2(Avance) &&
      String((Avance as Mapa).Parte_Id || "") === Id
    );
    if (Tiene_Avances) {
      Parte.Eliminado_Local = true;
      Actualizar_Marca_Plan_B2(Parte);
    } else {
      delete Partes[Id];
    }
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: Tiene_Avances
        ? "Parte archivada para preservar sus registros."
        : "Parte eliminada.",
      Resultado: { parte_id: Id, archivada: Tiene_Avances },
    };
  }

  let Cambios = false;
  Cambios = Aplicar_Texto_Plan_B2(Parte, Payload, "nombre", "Nombre") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Parte, Payload, "emoji", "Emoji") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Parte, Payload, "unidad", "Unidad") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Parte, Payload, "unidad_custom", "Unidad_Custom") || Cambios;
  Cambios = Aplicar_Numero_Plan_B2(Parte, Payload, "aporte_total", "Aporte_Total") || Cambios;
  Cambios = Aplicar_Fecha_Plan_B2(Parte, Payload, "fecha_inicio", "Fecha_Inicio") || Cambios;
  Cambios = Aplicar_Fecha_Plan_B2(Parte, Payload, "fecha_objetivo", "Fecha_Objetivo") || Cambios;
  if (Tiene_Campo_B2(Payload, "metadatos")) {
    Parte.Metadatos = Normalizar_Metadatos_Plan_B2(Payload.metadatos);
    Cambios = true;
  }
  if (!Cambios || !String(Parte.Nombre || "").trim()) {
    return Error_Mutacion_B2("No hay cambios validos para la parte.");
  }
  Actualizar_Marca_Plan_B2(Parte);
  Estado.Planes_Periodo = Modelo;
  return {
    Respuesta: `Parte actualizada: ${Parte.Nombre}.`,
    Resultado: { parte_id: Id },
  };
}

function Resolver_Destino_Avance_Plan_B2(
  Modelo: Mapa,
  Payload: Mapa
) {
  const Objetivos = Modelo.Objetivos as Mapa;
  const Subobjetivos = Modelo.Subobjetivos as Mapa;
  const Partes = Modelo.Partes as Mapa;
  const Parte_Id = Leer_String_B2(Payload, "parte_id");
  if (Parte_Id) {
    const Parte = Obtener_Item_Plan_B2(Partes, Parte_Id, "Parte");
    if (!Parte || Parte.Eliminado_Local === true) return null;
    const Subobjetivo = Obtener_Item_Plan_B2(
      Subobjetivos,
      String(Parte.Subobjetivo_Id || ""),
      "Subobjetivo"
    );
    if (!Subobjetivo || Subobjetivo.Eliminado_Local === true) return null;
    return {
      Objetivo_Id: String(Parte.Objetivo_Id || Subobjetivo.Objetivo_Id || ""),
      Subobjetivo_Id: String(Parte.Subobjetivo_Id || ""),
      Parte_Id,
      Unidad: String(Parte.Unidad_Custom || Parte.Unidad || ""),
      Fuente: "Subobjetivo",
    };
  }
  const Subobjetivo_Id = Leer_String_B2(Payload, "subobjetivo_id");
  if (Subobjetivo_Id) {
    const Subobjetivo = Obtener_Item_Plan_B2(
      Subobjetivos,
      Subobjetivo_Id,
      "Subobjetivo"
    );
    if (!Subobjetivo || Subobjetivo.Eliminado_Local === true) return null;
    return {
      Objetivo_Id: String(Subobjetivo.Objetivo_Id || ""),
      Subobjetivo_Id,
      Parte_Id: "",
      Unidad: String(Subobjetivo.Unidad_Custom || Subobjetivo.Unidad || ""),
      Fuente: "Subobjetivo",
    };
  }
  const Objetivo_Id = Leer_String_B2(Payload, "objetivo_id");
  const Objetivo = Obtener_Item_Plan_B2(Objetivos, Objetivo_Id, "Objetivo");
  if (!Objetivo || Objetivo.Eliminado_Local === true) return null;
  return {
    Objetivo_Id,
    Subobjetivo_Id: "",
    Parte_Id: "",
    Unidad: String(Objetivo.Unidad_Custom || Objetivo.Unidad || ""),
    Fuente: "Manual",
  };
}

function B2_Mutar_Avance_Plan(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Operacion = Obtener_Operacion_Plan_B2(Payload);
  if (!Operacion) return Error_Mutacion_B2("Operacion invalida.");
  const Modelo = Obtener_Modelo_Planes_B2(Estado);
  if (!Modelo) return Error_Mutacion_B2("No encontre Planes_Periodo.");
  const Avances = Modelo.Avances as Mapa;
  if (Operacion === "crear") {
    const Destino = Resolver_Destino_Avance_Plan_B2(Modelo, Payload);
    const Cantidad = Leer_Numero_B2(Payload, "cantidad") || 0;
    if (!Destino) return Error_Mutacion_B2("El destino del avance no existe.");
    if (Cantidad <= 0) {
      return Error_Mutacion_B2("El avance necesita cantidad positiva.");
    }
    const Id = Crear_Id_B2("Plan_Avance");
    const Fecha = Leer_Fecha_B2(
      Payload,
      "fecha",
      "fecha",
      Fecha_Argentina_B2()
    );
    const Hora = Leer_Hora_B2(
      Payload,
      "hora",
      "hora",
      Hora_Argentina_B2()
    );
    const Ahora = new Date().toISOString();
    Avances[Id] = {
      Id,
      ...Destino,
      Cantidad,
      Cantidad_Total: Cantidad,
      Unidad: Leer_String_B2(Payload, "unidad") || Destino.Unidad,
      Fecha,
      Hora,
      Fecha_Hora: `${Fecha}T${Hora || "00:00"}`,
      Nota: Leer_String_B2(Payload, "nota") || "ChatGPT",
      Metadatos: Normalizar_Metadatos_Plan_B2(Payload.metadatos),
      Origen_Tipo: "ChatGPT",
      Origen_Id: Id,
      Automatico: false,
      Distribucion: [],
      Orden: Object.keys(Avances).length,
      Creado_En: Ahora,
      Actualizado_En: Ahora,
    };
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: "Avance registrado.",
      Resultado: { avance_id: Id },
    };
  }

  const Id = Leer_String_B2(Payload, "avance_id");
  const Avance = Obtener_Item_Plan_B2(Avances, Id, "Avance");
  if (!Avance) return Error_Mutacion_B2("avance_id no existe.");
  if (Avance.Automatico === true) {
    return Error_Mutacion_B2(
      "Los avances automaticos son de solo lectura."
    );
  }
  if (Operacion === "borrar") {
    if (!Confirmar_Eliminacion_Plan_B2(Payload)) {
      return Error_Mutacion_B2(
        "El borrado requiere confirmar_eliminacion: true."
      );
    }
    delete Avances[Id];
    Estado.Planes_Periodo = Modelo;
    return {
      Respuesta: "Avance eliminado.",
      Resultado: { avance_id: Id },
    };
  }

  let Cambios = false;
  Cambios = Aplicar_Numero_Plan_B2(Avance, Payload, "cantidad", "Cantidad") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Avance, Payload, "unidad", "Unidad") || Cambios;
  Cambios = Aplicar_Texto_Plan_B2(Avance, Payload, "nota", "Nota") || Cambios;
  Cambios = Aplicar_Fecha_Plan_B2(Avance, Payload, "fecha", "Fecha") || Cambios;
  if (Tiene_Campo_B2(Payload, "hora")) {
    const Hora = Leer_Hora_B2(Payload, "hora", "hora", "");
    if (!Hora) return Error_Mutacion_B2("La hora no es valida.");
    Avance.Hora = Hora;
    Cambios = true;
  }
  if (Tiene_Campo_B2(Payload, "metadatos")) {
    Avance.Metadatos = Normalizar_Metadatos_Plan_B2(Payload.metadatos);
    Cambios = true;
  }
  if (!Cambios || Number(Avance.Cantidad) <= 0) {
    return Error_Mutacion_B2("No hay cambios validos para el avance.");
  }
  Avance.Cantidad_Total = Number(Avance.Cantidad);
  Avance.Fecha_Hora = `${String(Avance.Fecha || "")}T${String(
    Avance.Hora || "00:00"
  )}`;
  Actualizar_Marca_Plan_B2(Avance);
  Estado.Planes_Periodo = Modelo;
  return {
    Respuesta: "Avance actualizado.",
    Resultado: { avance_id: Id },
  };
}

function B2_Crear_Nota_Archivero(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Texto = Leer_String_B2(Payload, "texto", "Texto");
  if (!Texto) return Error_Mutacion_B2("La nota necesita texto.");
  const Archiveros = Asegurar_Array_B2(Estado, "Archiveros");
  if (Archiveros.length === 0) {
    Archiveros.push({
      Id: Crear_Id_Archivero_B2(),
      Nombre: "Ideas",
      Emoji: "\u{1f4a1}",
      Color_Fondo: "",
      Fecha_Creacion: Date.now(),
    });
  }
  const Cajon_Id = Resolver_Cajon_Archivero_B2(Archiveros, Payload);
  if (!Cajon_Id) return Error_Mutacion_B2("No encontre el cajon.");
  const Etiquetas = Normalizar_Etiquetas_Archivero_B2(
    Leer_Array_String_B2(Payload, "etiquetas", "Etiquetas")
  );
  Estado.Etiquetas_Archivero = Normalizar_Etiquetas_Archivero_B2([
    ...Leer_Array_String_Estado_B2(Estado, "Etiquetas_Archivero"),
    ...Etiquetas,
  ]);
  const Notas = Asegurar_Array_B2(Estado, "Notas_Archivero");
  const Nota = {
    Id: Crear_Id_Archivero_B2(),
    Archivero_Id: Cajon_Id,
    Titulo: Leer_String_B2(Payload, "titulo", "Titulo"),
    Texto,
    Origen: Leer_String_B2(Payload, "origen", "Origen") || "ChatGPT",
    Etiquetas,
    Adjuntos: [],
    Color_Fondo: "",
    Tipo: Es_URL_Archivero_B2(Texto) ? "Link" : "Texto",
    Fecha_Creacion: Date.now(),
  };
  Notas.push(Nota);
  return {
    Respuesta: "Nota creada en Archivero.",
    Resultado: { nota_id: Nota.Id, archivero_id: Cajon_Id },
  };
}

function B2_Crear_Item_Baul(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Nombre = Leer_String_B2(Payload, "nombre", "Nombre");
  if (!Nombre) return Error_Mutacion_B2("El item necesita nombre.");
  const Items = Asegurar_Array_B2(Estado, "Baul_Objetivos");
  const Item = {
    Id: Crear_Id_B2("Baul"),
    Nombre,
    Emoji: Leer_String_B2(Payload, "emoji", "Emoji"),
    Es_Bolsa: false,
    Categoria_Id: Leer_String_B2(
      Payload,
      "categoria_id",
      "Categoria_Id"
    ) || null,
    Etiquetas_Ids: [],
    Metadatos: {},
    Estado:
      Normalizar_Estado_Baul_B2(
        Leer_String_B2(Payload, "estado", "Estado")
      ),
    Archivada: false,
    Color_Baul: Leer_String_B2(Payload, "color", "Color"),
    Descripcion:
      Leer_String_B2(Payload, "descripcion", "Descripcion"),
    Horas_Aprox:
      Math.max(0, Leer_Numero_B2(
        Payload,
        "horas_aprox",
        "Horas_Aprox"
      ) || 0),
    Timeline: Leer_Fecha_B2(Payload, "timeline", "Timeline", ""),
    Orden_Personalizado: Items.length,
    Creado_En: new Date().toISOString(),
    Actualizado_En: new Date().toISOString(),
  };
  Items.push(Item);
  return {
    Respuesta: `Item creado en Baul: ${Nombre}.`,
    Resultado: { baul_id: Item.Id },
  };
}

function Decoteca_Tecas_Base_B2(): Mapa[] {
  return [
    {
      Id: "Biblioteca",
      Nombre: "Biblioteca",
      Icono: "📚",
      Color: "#2f7a55",
      Sistema: true,
      Unidad_Nombre: "libro",
      Subunidad_Nombre: "capitulo",
      Metrica: "paginas",
      Orden: 0,
    },
    {
      Id: "Musicoteca",
      Nombre: "Musicoteca",
      Icono: "🎵",
      Color: "#6f5aa8",
      Sistema: true,
      Unidad_Nombre: "album",
      Subunidad_Nombre: "cancion",
      Metrica: "escuchas",
      Orden: 1,
    },
    {
      Id: "Videoteca",
      Nombre: "Videoteca",
      Icono: "🎥",
      Color: "#a65f36",
      Sistema: true,
      Unidad_Nombre: "pelicula",
      Subunidad_Nombre: "visionado",
      Metrica: "visionados",
      Orden: 2,
    },
    {
      Id: "Ludoteca",
      Nombre: "Ludoteca",
      Icono: "🎮",
      Color: "#426f94",
      Sistema: true,
      Unidad_Nombre: "juego",
      Subunidad_Nombre: "sesion",
      Metrica: "horas",
      Orden: 3,
    },
  ];
}

function Leer_Decoteca_B2(Estado: Mapa) {
  const Raiz = Es_Mapa_B2(Estado.Decoteca)
    ? Estado.Decoteca as Mapa
    : {};
  const Tecas = Array.isArray(Raiz.Tecas)
    ? Raiz.Tecas.filter(Es_Mapa_B2) as Mapa[]
    : [];
  const Obras = Array.isArray(Raiz.Obras)
    ? Raiz.Obras.filter(Es_Mapa_B2) as Mapa[]
    : [];
  const Avances = Array.isArray(Raiz.Avances)
    ? Raiz.Avances.filter(Es_Mapa_B2) as Mapa[]
    : [];
  if (!Tecas.length) Tecas.push(...Decoteca_Tecas_Base_B2());
  Raiz.Inicializada = true;
  Raiz.Tecas = Tecas;
  Raiz.Obras = Obras;
  Raiz.Avances = Avances;
  Estado.Decoteca = Raiz;
  return { Raiz, Tecas, Obras, Avances };
}

function Normalizar_Teca_Id_Decoteca_B2(Valor: unknown) {
  const Original = Normalizar_Texto(Valor);
  const Clave = Normalizar_Texto_Busqueda(Original);
  const Alias: Record<string, string> = {
    biblioteca: "Biblioteca",
    libro: "Biblioteca",
    libros: "Biblioteca",
    musicoteca: "Musicoteca",
    musica: "Musicoteca",
    album: "Musicoteca",
    videoteca: "Videoteca",
    pelicula: "Videoteca",
    peliculas: "Videoteca",
    ludoteca: "Ludoteca",
    juego: "Ludoteca",
    juegos: "Ludoteca",
  };
  return Alias[Clave] || Original;
}

function Resolver_Teca_Decoteca_B2(
  Tecas: Mapa[],
  Valor: unknown,
  Fallback = "Biblioteca"
) {
  const Id = Normalizar_Teca_Id_Decoteca_B2(Valor || Fallback);
  const Teca = Tecas.find((Item) => String(Item.Id || "") === Id) ||
    Tecas.find((Item) =>
      Normalizar_Texto_Busqueda(Item.Nombre) ===
        Normalizar_Texto_Busqueda(Id)
    );
  if (!Teca) {
    return {
      Ok: false as const,
      Respuesta: Error_Mutacion_B2(
        `No encontre la teca "${Id}". Usa su teca_id o crea una teca primero.`
      ),
    };
  }
  return { Ok: true as const, Teca };
}

function Valor_Campo_B2(Payload: Mapa, ...Claves: string[]) {
  for (const Clave of Claves) {
    if (Object.prototype.hasOwnProperty.call(Payload, Clave)) {
      return Payload[Clave];
    }
  }
  return undefined;
}

function Texto_Campo_B2(Payload: Mapa, ...Claves: string[]) {
  const Valor = Valor_Campo_B2(Payload, ...Claves);
  return Valor == null ? "" : String(Valor).trim();
}

function Normalizar_Estado_Decoteca_B2(Valor: unknown) {
  const Clave = Normalizar_Texto_Busqueda(Valor);
  if (["planeada", "pendiente", "pendientes"].includes(Clave)) {
    return "Planeada";
  }
  if (["en curso", "encurso", "actual"].includes(Clave)) {
    return "En_Curso";
  }
  if (["terminada", "terminado", "finalizada", "finalizado"].includes(Clave)) {
    return "Terminada";
  }
  if (["abandonada", "abandonado", "pausada", "pausado"].includes(Clave)) {
    return "Abandonada";
  }
  return "Planeada";
}

function Normalizar_Lista_Decoteca_B2(
  Valor: unknown,
  Estado: string
) {
  const Clave = Normalizar_Texto_Busqueda(Valor);
  if (["biblioteca", "pendientes", "pendiente"].includes(Clave)) {
    return "Biblioteca";
  }
  if (["pausadas", "pausada"].includes(Clave)) return "Pausadas";
  if (["archivo", "archivadas", "archivada"].includes(Clave)) {
    return "Archivo";
  }
  if (Estado === "Terminada") return "Archivo";
  if (Estado === "Abandonada") return "Pausadas";
  return "Biblioteca";
}

function Normalizar_Prioridad_Decoteca_B2(Valor: unknown) {
  const Clave = Normalizar_Texto_Busqueda(Valor);
  if (Clave === "alta") return "Alta";
  if (Clave === "media") return "Media";
  if (Clave === "baja") return "Baja";
  return "Sin_Prioridad";
}

function Normalizar_Metadatos_Decoteca_B2(Valor: unknown) {
  const Resultado: Array<[string, string]> = [];
  const Agregar = (Clave_Raw: unknown, Valor_Raw: unknown) => {
    const Clave = Normalizar_Texto(Clave_Raw);
    const Dato = Normalizar_Texto(Valor_Raw);
    if (Clave && Dato) Resultado.push([Clave, Dato]);
  };
  if (Es_Mapa_B2(Valor)) {
    Object.entries(Valor).forEach(([Clave, Dato]) => Agregar(Clave, Dato));
  } else if (Array.isArray(Valor)) {
    Valor.forEach((Item) => {
      if (Array.isArray(Item)) {
        Agregar(Item[0], Item[1]);
      } else if (Es_Mapa_B2(Item)) {
        Agregar(Item.Clave || Item.clave, Item.Valor || Item.valor);
      } else {
        const [Clave, ...Resto] = String(Item || "").split(":");
        Agregar(Clave, Resto.join(":"));
      }
    });
  } else if (typeof Valor === "string") {
    Valor.split(/\r?\n/).forEach((Linea) => {
      const [Clave, ...Resto] = Linea.split(":");
      Agregar(Clave, Resto.join(":"));
    });
  }
  return Resultado;
}

function Normalizar_Partes_Decoteca_B2(
  Valor: unknown,
  Teca: Mapa
) {
  const Lista = Array.isArray(Valor)
    ? Valor
    : typeof Valor === "string"
    ? Valor.split(/\r?\n/)
    : [];
  const Unidad_Default = Normalizar_Texto(Teca.Metrica) || "unidades";
  return Lista.map((Item, Indice) => {
    const Base: Mapa = Es_Mapa_B2(Item) ? Item : { titulo: Item };
    const Titulo = Normalizar_Texto(
      Base.titulo || Base.Titulo || Base.nombre || Base.Nombre
    );
    if (!Titulo) return null;
    return {
      Id: Normalizar_Texto(Base.id || Base.Id) ||
        Crear_Id_B2("Dec_Parte"),
      Titulo,
      Tipo: Normalizar_Texto(Base.tipo || Base.Tipo) ||
        Normalizar_Texto(Teca.Subunidad_Nombre) || "parte",
      Orden: Math.max(1, Number(Base.orden || Base.Orden) || Indice + 1),
      Unidad: Normalizar_Texto(Base.unidad || Base.Unidad) || Unidad_Default,
      Cantidad_Total: Math.max(
        0,
        Number(Base.cantidad_total || Base.Cantidad_Total || Base.total) || 0
      ),
      Duracion_Segundos: Math.max(
        0,
        Number(Base.duracion_segundos || Base.Duracion_Segundos) || 0
      ),
      Pagina_Inicio: Math.max(
        0,
        Number(Base.pagina_inicio || Base.Pagina_Inicio) || 0
      ),
      Pagina_Fin: Math.max(
        0,
        Number(Base.pagina_fin || Base.Pagina_Fin) || 0
      ),
      Metadatos: Normalizar_Metadatos_Decoteca_B2(
        Base.metadatos || Base.Metadatos
      ),
    };
  }).filter(Boolean) as Mapa[];
}

function Es_Url_Portada_Decoteca_B2(Valor: unknown) {
  try {
    const Url = new URL(Normalizar_Texto(Valor));
    return ["http:", "https:"].includes(Url.protocol);
  } catch (_) {
    return false;
  }
}

function Construir_Datos_Teca_Decoteca_B2(
  Payload: Mapa,
  Existente: Mapa = {}
) {
  const Datos_Entrada = Es_Mapa_B2(
    Valor_Campo_B2(Payload, "datos_teca", "Datos_Teca")
  )
    ? Valor_Campo_B2(Payload, "datos_teca", "Datos_Teca") as Mapa
    : {};
  const Total_Raw = Tiene_Campo_B2(
    Payload,
    "total_unidades",
    "Total_Unidades"
  )
    ? Valor_Campo_B2(Payload, "total_unidades", "Total_Unidades")
    : Datos_Entrada.Total_Unidades ?? Datos_Entrada.total_unidades;
  const Unidad = Tiene_Campo_B2(Payload, "unidad", "Unidad")
    ? Texto_Campo_B2(Payload, "unidad", "Unidad")
    : Normalizar_Texto(Datos_Entrada.Unidad || Datos_Entrada.unidad) ||
      Normalizar_Texto(Existente.Unidad);
  const Fuente = Tiene_Campo_B2(Payload, "fuente_datos", "Fuente_Datos")
    ? Texto_Campo_B2(Payload, "fuente_datos", "Fuente_Datos")
    : Normalizar_Texto(Datos_Entrada.Fuente || Datos_Entrada.fuente) ||
      Normalizar_Texto(Existente.Fuente);
  return {
    ...Existente,
    ...Datos_Entrada,
    Unidad,
    Total_Unidades: Total_Raw == null || Total_Raw === ""
      ? Math.max(0, Number(Existente.Total_Unidades) || 0)
      : Math.max(0, Number(Total_Raw) || 0),
    Fuente,
  };
}

function B2_Crear_Obra_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Teca_Resultado = Resolver_Teca_Decoteca_B2(
    Decoteca.Tecas,
    Valor_Campo_B2(Payload, "teca_id", "Teca_Id", "teca", "Teca")
  );
  if (!Teca_Resultado.Ok) return Teca_Resultado.Respuesta;
  const Titulo = Texto_Campo_B2(Payload, "titulo", "Titulo");
  if (!Titulo) return Error_Mutacion_B2("La obra necesita titulo.");
  const Estado_Obra = Normalizar_Estado_Decoteca_B2(
    Valor_Campo_B2(Payload, "estado", "Estado") || "Planeada"
  );
  const Portada_Url = Texto_Campo_B2(
    Payload,
    "portada_url",
    "Portada_Url"
  );
  if (Portada_Url && !Es_Url_Portada_Decoteca_B2(Portada_Url)) {
    return Error_Mutacion_B2(
      "portada_url debe ser una URL publica http o https."
    );
  }
  const Partes = Normalizar_Partes_Decoteca_B2(
    Valor_Campo_B2(Payload, "partes", "Partes"),
    Teca_Resultado.Teca
  );
  const Datos_Teca = Construir_Datos_Teca_Decoteca_B2(Payload, {});
  const Obra: Mapa = {
    Id: Crear_Id_B2("Dec_Obra"),
    Orden: Decoteca.Obras.length + 1,
    Teca_Id: Teca_Resultado.Teca.Id,
    Titulo,
    Creador: Texto_Campo_B2(Payload, "creador", "Creador"),
    Anio: Texto_Campo_B2(Payload, "anio", "Anio"),
    Formato: Texto_Campo_B2(Payload, "formato", "Formato") ||
      Normalizar_Texto(Teca_Resultado.Teca.Unidad_Nombre) || "Obra",
    Genero: Texto_Campo_B2(Payload, "genero", "Genero"),
    Subgenero: Texto_Campo_B2(Payload, "subgenero", "Subgenero"),
    Descripcion: Texto_Campo_B2(Payload, "descripcion", "Descripcion"),
    Fecha_Inicio: Texto_Campo_B2(Payload, "fecha_inicio", "Fecha_Inicio"),
    Fecha_Fin: Texto_Campo_B2(Payload, "fecha_fin", "Fecha_Fin"),
    Estado: Estado_Obra,
    Lista: Normalizar_Lista_Decoteca_B2(
      Valor_Campo_B2(Payload, "lista", "Lista"),
      Estado_Obra
    ),
    Prioridad: Normalizar_Prioridad_Decoteca_B2(
      Valor_Campo_B2(Payload, "prioridad", "Prioridad")
    ),
    Motivo: Texto_Campo_B2(Payload, "motivo", "Motivo"),
    Origen: Texto_Campo_B2(Payload, "origen", "Origen") || "ChatGPT",
    Fecha_Ingreso: Texto_Campo_B2(
      Payload,
      "fecha_ingreso",
      "Fecha_Ingreso"
    ) || Fecha_Argentina_B2(),
    Periodo: "Sin_Periodo",
    Periodo_Label: "",
    Progreso: 0,
    Meta_Principal: Texto_Campo_B2(
      Payload,
      "meta_principal",
      "Meta_Principal"
    ),
    Rating: Texto_Campo_B2(Payload, "rating", "Rating"),
    Color: Normalizar_Texto(Teca_Resultado.Teca.Color),
    Portada_Emoji: Texto_Campo_B2(
      Payload,
      "portada_emoji",
      "Portada_Emoji"
    ) || Normalizar_Texto(Teca_Resultado.Teca.Icono) || "📚",
    Portada_Texto: Texto_Campo_B2(
      Payload,
      "portada_texto",
      "Portada_Texto"
    ) || Titulo,
    Portada_Tipo: Portada_Url ? "Url" : "Emoji",
    Portada_Url,
    Portada_Data_Url: "",
    Portada_Mime: "",
    Portada_Nombre: "",
    Portada_Tamano: 0,
    Plan: "",
    Subobjetivos: Partes.map((Parte) => String(Parte.Titulo || "")),
    Partes,
    Datos_Teca,
    Metadatos: Normalizar_Metadatos_Decoteca_B2(
      Valor_Campo_B2(Payload, "metadatos", "Metadatos")
    ),
  };
  Decoteca.Obras.push(Obra);
  return {
    Respuesta: `Obra creada en ${Teca_Resultado.Teca.Nombre || Teca_Resultado.Teca.Id}: ${Titulo}.`,
    Resultado: { obra_id: Obra.Id, teca_id: Obra.Teca_Id },
  };
}

function Buscar_Obra_Decoteca_B2(
  Decoteca: ReturnType<typeof Leer_Decoteca_B2>,
  Payload: Mapa
) {
  const Teca_Id = Normalizar_Teca_Id_Decoteca_B2(
    Valor_Campo_B2(Payload, "teca_id", "Teca_Id")
  );
  const Obras = Teca_Id
    ? Decoteca.Obras.filter((Obra) => String(Obra.Teca_Id || "") === Teca_Id)
    : Decoteca.Obras;
  return Buscar_Item_B2(Obras, Payload, "obra_id", "Titulo");
}

function Aplicar_Cambios_Obra_Decoteca_B2(
  Obra: Mapa,
  Payload: Mapa,
  Tecas: Mapa[]
) {
  const Resultado: Mapa = { ...Obra };
  const Asignar_Texto = (Destino: string, ...Claves: string[]) => {
    if (Tiene_Campo_B2(Payload, ...Claves)) {
      Resultado[Destino] = Texto_Campo_B2(Payload, ...Claves);
    }
  };
  const Teca_Campo = Tiene_Campo_B2(
    Payload,
    "teca_id",
    "Teca_Id",
    "teca",
    "Teca"
  );
  if (Teca_Campo) {
    const Teca = Resolver_Teca_Decoteca_B2(
      Tecas,
      Valor_Campo_B2(Payload, "teca_id", "Teca_Id", "teca", "Teca")
    );
    if (!Teca.Ok) return Teca.Respuesta;
    Resultado.Teca_Id = Teca.Teca.Id;
    if (!Resultado.Portada_Emoji) Resultado.Portada_Emoji = Teca.Teca.Icono;
  }
  Asignar_Texto("Titulo", "titulo", "Titulo");
  if (!Normalizar_Texto(Resultado.Titulo)) {
    return Error_Mutacion_B2("La obra necesita titulo.");
  }
  Asignar_Texto("Creador", "creador", "Creador");
  Asignar_Texto("Anio", "anio", "Anio");
  Asignar_Texto("Formato", "formato", "Formato");
  Asignar_Texto("Genero", "genero", "Genero");
  Asignar_Texto("Subgenero", "subgenero", "Subgenero");
  Asignar_Texto("Descripcion", "descripcion", "Descripcion");
  Asignar_Texto("Fecha_Inicio", "fecha_inicio", "Fecha_Inicio");
  Asignar_Texto("Fecha_Fin", "fecha_fin", "Fecha_Fin");
  Asignar_Texto("Motivo", "motivo", "Motivo");
  Asignar_Texto("Origen", "origen", "Origen");
  Asignar_Texto("Fecha_Ingreso", "fecha_ingreso", "Fecha_Ingreso");
  Asignar_Texto("Meta_Principal", "meta_principal", "Meta_Principal");
  Asignar_Texto("Rating", "rating", "Rating");
  Asignar_Texto("Portada_Emoji", "portada_emoji", "Portada_Emoji");
  Asignar_Texto("Portada_Texto", "portada_texto", "Portada_Texto");
  if (Tiene_Campo_B2(Payload, "estado", "Estado")) {
    Resultado.Estado = Normalizar_Estado_Decoteca_B2(
      Valor_Campo_B2(Payload, "estado", "Estado")
    );
    if (!Tiene_Campo_B2(Payload, "lista", "Lista")) {
      Resultado.Lista = Normalizar_Lista_Decoteca_B2(
        Resultado.Lista,
        String(Resultado.Estado)
      );
    }
  }
  if (Tiene_Campo_B2(Payload, "lista", "Lista")) {
    Resultado.Lista = Normalizar_Lista_Decoteca_B2(
      Valor_Campo_B2(Payload, "lista", "Lista"),
      String(Resultado.Estado || "Planeada")
    );
  }
  if (Tiene_Campo_B2(Payload, "prioridad", "Prioridad")) {
    Resultado.Prioridad = Normalizar_Prioridad_Decoteca_B2(
      Valor_Campo_B2(Payload, "prioridad", "Prioridad")
    );
  }
  if (Tiene_Campo_B2(Payload, "metadatos", "Metadatos")) {
    Resultado.Metadatos = Normalizar_Metadatos_Decoteca_B2(
      Valor_Campo_B2(Payload, "metadatos", "Metadatos")
    );
  }
  const Teca = Resolver_Teca_Decoteca_B2(Tecas, Resultado.Teca_Id);
  if (!Teca.Ok) return Teca.Respuesta;
  if (Tiene_Campo_B2(Payload, "partes", "Partes")) {
    const Partes = Normalizar_Partes_Decoteca_B2(
      Valor_Campo_B2(Payload, "partes", "Partes"),
      Teca.Teca
    );
    Resultado.Partes = Partes;
    Resultado.Subobjetivos = Partes.map((Parte) => String(Parte.Titulo || ""));
  }
  if (Tiene_Campo_B2(
    Payload,
    "datos_teca",
    "Datos_Teca",
    "total_unidades",
    "Total_Unidades",
    "unidad",
    "Unidad",
    "fuente_datos",
    "Fuente_Datos"
  )) {
    Resultado.Datos_Teca = Construir_Datos_Teca_Decoteca_B2(
      Payload,
      Es_Mapa_B2(Resultado.Datos_Teca) ? Resultado.Datos_Teca : {}
    );
  }
  if (Tiene_Campo_B2(Payload, "portada_url", "Portada_Url")) {
    const Portada_Url = Texto_Campo_B2(
      Payload,
      "portada_url",
      "Portada_Url"
    );
    if (Portada_Url && !Es_Url_Portada_Decoteca_B2(Portada_Url)) {
      return Error_Mutacion_B2(
        "portada_url debe ser una URL publica http o https."
      );
    }
    Resultado.Portada_Tipo = Portada_Url ? "Url" : "Emoji";
    Resultado.Portada_Url = Portada_Url;
    Resultado.Portada_Data_Url = "";
    Resultado.Portada_Mime = "";
    Resultado.Portada_Nombre = "";
    Resultado.Portada_Tamano = 0;
  }
  return { Respuesta: "", Resultado };
}

function B2_Editar_Obra_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Busqueda = Buscar_Obra_Decoteca_B2(Decoteca, Payload);
  if (!Busqueda.Ok) return Busqueda.Respuesta;
  const Indice = Decoteca.Obras.findIndex((Obra) =>
    String(Obra.Id || "") === String(Busqueda.Item.Id || "")
  );
  const Aplicacion = Aplicar_Cambios_Obra_Decoteca_B2(
    Busqueda.Item,
    Payload,
    Decoteca.Tecas
  );
  if (Aplicacion.Cambios === false || !Aplicacion.Resultado) {
    return Aplicacion.Cambios === false
      ? Aplicacion
      : Error_Mutacion_B2("No se pudo actualizar la obra.");
  }
  const Obra_Editada = Aplicacion.Resultado;
  if (JSON.stringify(Busqueda.Item) === JSON.stringify(Obra_Editada)) {
    return Error_Mutacion_B2("No hubo cambios en la obra.");
  }
  Decoteca.Obras[Indice] = Obra_Editada;
  return {
    Respuesta: `Obra actualizada: ${Obra_Editada.Titulo}.`,
    Resultado: { obra_id: Obra_Editada.Id },
  };
}

function B2_Borrar_Obra_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  if (!Leer_Boolean_B2(Payload, false, "confirmar_eliminacion")) {
    return Error_Mutacion_B2(
      "Confirma la eliminacion de la obra con confirmar_eliminacion: true."
    );
  }
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Busqueda = Buscar_Obra_Decoteca_B2(Decoteca, Payload);
  if (!Busqueda.Ok) return Busqueda.Respuesta;
  const Obra_Id = String(Busqueda.Item.Id || "");
  Decoteca.Obras.splice(Decoteca.Obras.findIndex((Obra) =>
    String(Obra.Id || "") === Obra_Id
  ), 1);
  const Registros_Eliminados = Decoteca.Avances.filter((Avance) =>
    String(Avance.Obra_Id || "") === Obra_Id
  ).length;
  Decoteca.Raiz.Avances = Decoteca.Avances.filter((Avance) =>
    String(Avance.Obra_Id || "") !== Obra_Id
  );
  return {
    Respuesta: `Obra eliminada: ${Busqueda.Item.Titulo}.`,
    Resultado: { obra_id: Obra_Id, registros_eliminados: Registros_Eliminados },
  };
}

function B2_Crear_Teca_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Nombre = Texto_Campo_B2(Payload, "nombre", "Nombre");
  if (!Nombre) return Error_Mutacion_B2("La teca necesita nombre.");
  const Teca_Id = Texto_Campo_B2(Payload, "teca_id", "Teca_Id") ||
    Crear_Id_B2("Dec_Teca");
  if (Decoteca.Tecas.some((Teca) => String(Teca.Id || "") === Teca_Id)) {
    return Error_Mutacion_B2("Ya existe una teca con ese teca_id.");
  }
  const Teca: Mapa = {
    Id: Teca_Id,
    Nombre,
    Descripcion: Texto_Campo_B2(Payload, "descripcion", "Descripcion"),
    Icono: Texto_Campo_B2(Payload, "icono", "Icono") || "📚",
    Color: Texto_Campo_B2(Payload, "color", "Color") || "#2f7a55",
    Unidad_Nombre: Texto_Campo_B2(
      Payload,
      "unidad_nombre",
      "Unidad_Nombre"
    ) || "obra",
    Subunidad_Nombre: Texto_Campo_B2(
      Payload,
      "subunidad_nombre",
      "Subunidad_Nombre"
    ) || "parte",
    Metrica: Texto_Campo_B2(Payload, "metrica", "Metrica") || "unidades",
    Sistema: false,
    Orden: Decoteca.Tecas.length,
  };
  Decoteca.Tecas.push(Teca);
  return {
    Respuesta: `Teca creada: ${Nombre}.`,
    Resultado: { teca_id: Teca.Id },
  };
}

function B2_Editar_Teca_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Teca_Resultado = Resolver_Teca_Decoteca_B2(
    Decoteca.Tecas,
    Valor_Campo_B2(Payload, "teca_id", "Teca_Id", "teca", "Teca")
  );
  if (!Teca_Resultado.Ok) return Teca_Resultado.Respuesta;
  const Teca = Teca_Resultado.Teca;
  const Antes = JSON.stringify(Teca);
  [
    ["Nombre", "nombre", "Nombre"],
    ["Descripcion", "descripcion", "Descripcion"],
    ["Icono", "icono", "Icono"],
    ["Color", "color", "Color"],
    ["Unidad_Nombre", "unidad_nombre", "Unidad_Nombre"],
    ["Subunidad_Nombre", "subunidad_nombre", "Subunidad_Nombre"],
    ["Metrica", "metrica", "Metrica"],
  ].forEach(([Destino, ...Claves]) => {
    if (Tiene_Campo_B2(Payload, ...Claves)) {
      Teca[Destino] = Texto_Campo_B2(Payload, ...Claves);
    }
  });
  if (!Normalizar_Texto(Teca.Nombre) && !Normalizar_Texto(Teca.Nombre_Key)) {
    return Error_Mutacion_B2("La teca necesita nombre.");
  }
  if (Antes === JSON.stringify(Teca)) {
    return Error_Mutacion_B2("No hubo cambios en la teca.");
  }
  return {
    Respuesta: `Teca actualizada: ${Teca.Nombre || Teca.Id}.`,
    Resultado: { teca_id: Teca.Id },
  };
}

function B2_Borrar_Teca_Decoteca(
  Estado: Mapa,
  Payload: Mapa
): Resultado_Mutacion_B2 {
  if (!Leer_Boolean_B2(Payload, false, "confirmar_eliminacion")) {
    return Error_Mutacion_B2(
      "Confirma la eliminacion de la teca con confirmar_eliminacion: true."
    );
  }
  const Decoteca = Leer_Decoteca_B2(Estado);
  const Teca_Resultado = Resolver_Teca_Decoteca_B2(
    Decoteca.Tecas,
    Valor_Campo_B2(Payload, "teca_id", "Teca_Id", "teca", "Teca")
  );
  if (!Teca_Resultado.Ok) return Teca_Resultado.Respuesta;
  const Teca = Teca_Resultado.Teca;
  if (Teca.Sistema === true) {
    return Error_Mutacion_B2("No se pueden borrar las tecas del sistema.");
  }
  if (Decoteca.Obras.some((Obra) => String(Obra.Teca_Id || "") === String(Teca.Id || ""))) {
    return Error_Mutacion_B2(
      "La teca tiene obras. Reubicalas o borralas antes de eliminarla."
    );
  }
  Decoteca.Raiz.Tecas = Decoteca.Tecas.filter((Item) =>
    String(Item.Id || "") !== String(Teca.Id || "")
  );
  return {
    Respuesta: `Teca eliminada: ${Teca.Nombre || Teca.Id}.`,
    Resultado: { teca_id: Teca.Id },
  };
}

function Error_Mutacion_B2(
  Respuesta: string,
  Status = 400
): Resultado_Mutacion_B2 {
  return {
    Respuesta,
    Cambios: false,
    Status,
  };
}

function Es_Mapa_B2(Valor: unknown): Valor is Mapa {
  return Boolean(
    Valor &&
    typeof Valor === "object" &&
    !Array.isArray(Valor)
  );
}

function Clonar_B2<T>(Valor: T): T {
  return JSON.parse(JSON.stringify(Valor || {}));
}

function Crear_Id_B2(Prefijo: string) {
  return `${Prefijo}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function Crear_Id_Archivero_B2() {
  return `ar_${Date.now().toString(36)}_${
    Math.random().toString(36).slice(2, 7)
  }`;
}

function Fecha_Argentina_B2(Offset_Dias = 0) {
  const Partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: Timezone_Argentina,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const Mapa_Partes = Object.fromEntries(
    Partes.map((Parte) => [Parte.type, Parte.value])
  );
  const Fecha = new Date(
    `${Mapa_Partes.year}-${Mapa_Partes.month}-` +
      `${Mapa_Partes.day}T00:00:00-03:00`
  );
  Fecha.setDate(Fecha.getDate() + Offset_Dias);
  return Fecha.toISOString().slice(0, 10);
}

function Hora_Argentina_B2() {
  const Partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: Timezone_Argentina,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const Mapa_Partes = Object.fromEntries(
    Partes.map((Parte) => [Parte.type, Parte.value])
  );
  return `${Mapa_Partes.hour}:${Mapa_Partes.minute}`;
}

function Resolver_Fecha_Relativa_B2(
  Payload: Mapa,
  Fallback: string
) {
  const Expresion = Normalizar_Texto_Busqueda(
    Payload.fecha_relativa || Payload.Fecha_Relativa
  );
  if (!Expresion) {
    return Leer_Fecha_B2(Payload, "fecha", "Fecha", Fallback);
  }
  const Hoy = Fecha_Argentina_B2();
  if (["hoy", "today"].includes(Expresion)) return Hoy;
  if (["manana", "mañana", "tomorrow"].includes(Expresion)) {
    return Fecha_Argentina_B2(1);
  }
  if (["pasado manana", "pasado mañana"].includes(Expresion)) {
    return Fecha_Argentina_B2(2);
  }
  const En_Dias = Expresion.match(/^en (\d+) dias?$/);
  if (En_Dias) return Fecha_Argentina_B2(Number(En_Dias[1]));
  const Dias = new Map([
    ["domingo", 0], ["lunes", 1], ["martes", 2],
    ["miercoles", 3], ["miércoles", 3], ["jueves", 4],
    ["viernes", 5], ["sabado", 6], ["sábado", 6],
  ]);
  const Coincidencia = Expresion.match(/^(?:proximo |pr[oó]ximo )?(domingo|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado)$/);
  if (Coincidencia) {
    const Base = Parsear_Fecha_ISO(Hoy)!;
    const Dia = Dias.get(Coincidencia[1])!;
    let Diferencia = (Dia - Base.getUTCDay() + 7) % 7;
    if (Diferencia === 0 || Expresion.startsWith("proximo") || Expresion.startsWith("próximo")) {
      Diferencia += 7;
    }
    return Formatear_Fecha_ISO(Sumar_Dias(Base, Diferencia));
  }
  return "";
}

function Asegurar_Array_B2(
  Estado: Mapa,
  Clave: string
): Mapa[] {
  if (!Array.isArray(Estado[Clave])) {
    Estado[Clave] = [];
  }
  return Estado[Clave] as Mapa[];
}

function Leer_String_B2(
  Payload: Mapa,
  ...Claves: string[]
) {
  for (const Clave of Claves) {
    const Valor = Payload[Clave];
    if (Valor == null) continue;
    const Texto = String(Valor).trim();
    if (Texto) return Texto;
  }
  return "";
}

function Leer_Numero_B2(
  Payload: Mapa,
  ...Claves: string[]
) {
  for (const Clave of Claves) {
    const Valor = Payload[Clave];
    if (Valor == null || Valor === "") continue;
    const Numero = Number(String(Valor).replace(",", "."));
    if (Number.isFinite(Numero)) return Numero;
  }
  return null;
}

function Leer_Boolean_B2(
  Payload: Mapa,
  Fallback: boolean,
  ...Claves: string[]
) {
  for (const Clave of Claves) {
    if (!(Clave in Payload)) continue;
    const Valor = Payload[Clave];
    if (typeof Valor === "boolean") return Valor;
    const Texto = Normalizar_Texto_Busqueda(Valor);
    if (["true", "1", "si", "hecha"].includes(Texto)) {
      return true;
    }
    if (["false", "0", "no", "pendiente"].includes(Texto)) {
      return false;
    }
  }
  return Fallback;
}

function Leer_Fecha_B2(
  Payload: Mapa,
  Clave_A: string,
  Clave_B: string,
  Fallback: string
) {
  const Valor = Leer_String_B2(Payload, Clave_A, Clave_B);
  if (!Valor) return Fallback;
  if (Es_Fecha_ISO_Valida(Valor)) return Valor;
  return Fallback;
}

function Leer_Hora_B2(
  Payload: Mapa,
  Clave_A: string,
  Clave_B: string,
  Fallback: string
) {
  const Valor = Leer_String_B2(Payload, Clave_A, Clave_B);
  if (!Valor) return Fallback;
  const Match = Valor.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!Match) return Fallback;
  return `${Match[1].padStart(2, "0")}:${Match[2]}`;
}

function Leer_Array_String_B2(
  Payload: Mapa,
  ...Claves: string[]
) {
  for (const Clave of Claves) {
    const Valor = Payload[Clave];
    if (Array.isArray(Valor)) {
      return Valor.map((Item) => String(Item || "").trim())
        .filter(Boolean);
    }
    if (typeof Valor === "string" && Valor.trim()) {
      return Valor.split(",")
        .map((Item) => Item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function Leer_Array_String_Estado_B2(
  Estado: Mapa,
  Clave: string
) {
  return Array.isArray(Estado[Clave])
    ? (Estado[Clave] as unknown[])
      .map((Item) => String(Item || "").trim())
      .filter(Boolean)
    : [];
}

function Obtener_Idempotency_Key_B2(
  Payload: Mapa
) {
  return Leer_String_B2(
    Payload,
    "idempotency_key",
    "Idempotency_Key"
  ).slice(0, 120);
}

function Buscar_Item_B2(
  Items: Mapa[],
  Payload: Mapa,
  Campo_Id: string,
  Campo_Nombre: string
) {
  const Id = Leer_String_B2(
    Payload,
    Campo_Id,
    Campo_Id.replace(/_id$/, "_Id"),
    "id",
    "Id"
  );
  if (Id) {
    const Item = Items.find((Actual) =>
      String(Actual.Id || "") === Id
    );
    if (Item) return { Ok: true as const, Item };
    return {
      Ok: false as const,
      Respuesta: Error_Mutacion_B2(`No encontre el id ${Id}.`),
    };
  }
  const Texto = Leer_String_B2(
    Payload,
    "busqueda",
    "Busqueda",
    "nombre",
    "Nombre"
  );
  return Buscar_Por_Nombre_B2(Items, Texto, Campo_Nombre);
}

function Buscar_Por_Nombre_B2(
  Items: Mapa[],
  Texto: string,
  Campo: string
) {
  const Busqueda = Normalizar_Texto_Busqueda(Texto);
  if (!Busqueda) {
    return {
      Ok: false as const,
      Respuesta: Error_Mutacion_B2("Necesito un texto de busqueda."),
    };
  }
  const Exactas = Items.filter((Item) =>
    Normalizar_Texto_Busqueda(String(Item[Campo] || "")) ===
      Busqueda
  );
  const Coinciden = Exactas.length
    ? Exactas
    : Items.filter((Item) =>
      Normalizar_Texto_Busqueda(String(Item[Campo] || ""))
        .includes(Busqueda)
    );
  if (!Coinciden.length) {
    return {
      Ok: false as const,
      Respuesta:
        Error_Mutacion_B2(`No encontre coincidencias para "${Texto}".`),
    };
  }
  if (Coinciden.length > 1) {
    return {
      Ok: false as const,
      Respuesta: Error_Mutacion_B2(
        "Hay varias coincidencias. Usa un nombre mas especifico."
      ),
    };
  }
  return {
    Ok: true as const,
    Item: Coinciden[0],
  };
}

function Asegurar_Cajon_Tareas_B2(
  Estado: Mapa,
  Cajon: string
) {
  const Cajones = Array.isArray(Estado.Tareas_Cajones_Definidos)
    ? Estado.Tareas_Cajones_Definidos as unknown[]
    : [];
  const Normalizados = Cajones.map((Item) => String(Item || ""));
  if (!Normalizados.some((Item) =>
    Normalizar_Texto_Busqueda(Item) ===
      Normalizar_Texto_Busqueda(Cajon)
  )) {
    Normalizados.unshift(Cajon);
  }
  Estado.Tareas_Cajones_Definidos = Array.from(new Set(Normalizados));
}

function Obtener_Planes_Slot_B2(Estado: Mapa) {
  if (!Es_Mapa_B2(Estado.Planes_Slot)) {
    Estado.Planes_Slot = {};
  }
  return Estado.Planes_Slot as Mapa;
}

function Obtener_Paso_Slot_B2(Estado: Mapa) {
  const Config = Es_Mapa_B2(Estado.Config_Extra)
    ? Estado.Config_Extra as Mapa
    : {};
  const Duracion = Number(Config.Duracion_Default);
  return [0.25, 0.5, 1].includes(Duracion)
    ? Duracion
    : 1;
}

function Hora_A_Numero_B2(Hora: string) {
  const Match = /^(\d{2}):(\d{2})$/.exec(Hora);
  if (!Match) return 0;
  return Number(Match[1]) + Number(Match[2]) / 60;
}

function Formatear_Hora_Clave_B2(Hora: number) {
  const Normalizada = Math.round(Hora * 100) / 100;
  return String(Normalizada);
}

function Clave_Slot_Tarea_B2(
  Estado: Mapa,
  Fecha: string,
  Hora: string
) {
  const Paso = Obtener_Paso_Slot_B2(Estado);
  const Inicio = Math.floor(Hora_A_Numero_B2(Hora) / Paso) *
    Paso;
  return `${Fecha}|${Formatear_Hora_Clave_B2(Inicio)}`;
}

function Guardar_Items_Plan_Slot_B2(
  Planes_Slot: Mapa,
  Clave: string,
  Items: Mapa[]
) {
  const Plan_Actual = Es_Mapa_B2(Planes_Slot[Clave])
    ? Planes_Slot[Clave] as Mapa
    : {};
  const Nota = String(Plan_Actual.Nota || "").trim();
  if (!Items.length && !Nota) {
    delete Planes_Slot[Clave];
    return;
  }
  Plan_Actual.Items = Items;
  if (!Nota) {
    delete Plan_Actual.Nota;
  }
  Planes_Slot[Clave] = Plan_Actual;
}

function Desplanificar_Tarea_B2(
  Estado: Mapa,
  Tarea: Mapa
) {
  const Tarea_Id = String(Tarea.Id || "");
  const Planes_Slot = Obtener_Planes_Slot_B2(Estado);
  Object.entries(Planes_Slot).forEach(([Clave, Plan_Raw]) => {
    if (!Es_Mapa_B2(Plan_Raw)) return;
    const Plan = Plan_Raw as Mapa;
    if (!Array.isArray(Plan.Items)) return;
    const Items = Plan.Items.filter((Item) => {
      if (!Es_Mapa_B2(Item)) return true;
      const Entrada = Item as Mapa;
      return String(Entrada.Tarea_Id || "") !== Tarea_Id &&
        String(Entrada.Id || "") !==
          String(Tarea.Plan_Item_Id || "");
    }) as Mapa[];
    if (Items.length !== Plan.Items.length) {
      Guardar_Items_Plan_Slot_B2(Planes_Slot, Clave, Items);
    }
  });

  const Eventos = Asegurar_Array_B2(Estado, "Eventos");
  for (let Indice = Eventos.length - 1; Indice >= 0; Indice--) {
    const Evento = Eventos[Indice];
    if (
      String(Evento.Id || "") !== String(Tarea.Evento_Id || "") ||
      !Array.isArray(Evento.Abordaje)
    ) {
      continue;
    }
    const Abordaje = Evento.Abordaje.filter((Item) => {
      if (!Es_Mapa_B2(Item)) return true;
      const Entrada = Item as Mapa;
      return String(Entrada.Tarea_Id || "") !== Tarea_Id &&
        String(Entrada.Id || "") !==
          String(Tarea.Abordaje_Id || "");
    });
    if (Abordaje.length === 0 && Evento.Origen === "tarea") {
      Eventos.splice(Indice, 1);
    } else {
      Evento.Abordaje = Abordaje;
    }
  }

  Tarea.Planeada = false;
  Tarea.Evento_Id = "";
  Tarea.Abordaje_Id = "";
  Tarea.Plan_Clave = "";
  Tarea.Plan_Item_Id = "";
}

function Planificar_Tarea_B2(
  Estado: Mapa,
  Tarea: Mapa
) {
  const Fecha = String(Tarea.Fecha || "");
  const Hora = String(Tarea.Hora || "");
  if (!Fecha || !Hora) return false;
  const Planes_Slot = Obtener_Planes_Slot_B2(Estado);
  const Clave = Clave_Slot_Tarea_B2(Estado, Fecha, Hora);
  const Plan = Es_Mapa_B2(Planes_Slot[Clave])
    ? Planes_Slot[Clave] as Mapa
    : {};
  const Items = Array.isArray(Plan.Items)
    ? Plan.Items.filter((Item) =>
      !Es_Mapa_B2(Item) ||
      String((Item as Mapa).Tarea_Id || "") !==
        String(Tarea.Id || "")
    ) as Mapa[]
    : [];
  const Item_Id = Crear_Id_B2("Plan_Slot_Item");
  Items.push({
    Id: Item_Id,
    Emoji: String(Tarea.Emoji || "\u2022"),
    Texto: String(Tarea.Nombre || ""),
    Estado: Tarea.Estado === "completada"
      ? "Realizado"
      : "Planeado",
    Tipo: "Texto",
    Tarea_Id: String(Tarea.Id || ""),
  });
  Plan.Items = Items;
  Planes_Slot[Clave] = Plan;
  Tarea.Planeada = true;
  Tarea.Evento_Id = "";
  Tarea.Abordaje_Id = "";
  Tarea.Plan_Clave = Clave;
  Tarea.Plan_Item_Id = Item_Id;
  return true;
}

function Sincronizar_Estado_Tarea_Vinculada_B2(
  Estado: Mapa,
  Tarea: Mapa
) {
  const Tarea_Id = String(Tarea.Id || "");
  const Estado_Plan = Tarea.Estado === "completada"
    ? "Realizado"
    : "Planeado";
  const Planes_Slot = Obtener_Planes_Slot_B2(Estado);
  Object.values(Planes_Slot).forEach((Plan_Raw) => {
    if (!Es_Mapa_B2(Plan_Raw)) return;
    const Plan = Plan_Raw as Mapa;
    if (!Array.isArray(Plan.Items)) return;
    Plan.Items.forEach((Item) => {
      if (!Es_Mapa_B2(Item)) return;
      const Entrada = Item as Mapa;
      if (String(Entrada.Tarea_Id || "") === Tarea_Id) {
        Entrada.Estado = Estado_Plan;
        Entrada.Texto = String(Tarea.Nombre || "");
        Entrada.Emoji = String(Tarea.Emoji || "\u2022");
      }
    });
  });
  const Evento_Id = String(Tarea.Evento_Id || "");
  if (!Evento_Id) return;
  const Eventos = Asegurar_Array_B2(Estado, "Eventos");
  const Evento = Eventos.find((Item) =>
    String(Item.Id || "") === Evento_Id
  );
  if (!Evento || !Array.isArray(Evento.Abordaje)) return;
  Evento.Abordaje.forEach((Item) => {
    if (!Es_Mapa_B2(Item)) return;
    const Entrada = Item as Mapa;
    if (String(Entrada.Tarea_Id || "") === Tarea_Id) {
      Entrada.Estado = Tarea.Estado === "completada"
        ? "Completado"
        : "Pendiente";
      Entrada.Texto = String(Tarea.Nombre || "");
      Entrada.Emoji = String(Tarea.Emoji || "\u2022");
    }
  });
}

function Numero_Desde_Mapa_B2(
  Valor: unknown,
  Clave: string,
  Fallback: number
) {
  const M = Es_Mapa_B2(Valor) ? Valor : {};
  const Numero = Number(M[Clave]);
  return Number.isFinite(Numero) ? Numero : Fallback;
}

function Habito_Clave_Periodo_B2(
  Habito: Mapa,
  Fecha: string
) {
  const Meta = Es_Mapa_B2(Habito.Meta) ? Habito.Meta as Mapa : {};
  const Periodo = String(Meta.Periodo || "Dia");
  if (Periodo === "Semana") {
    return Obtener_Lunes_ISO_Desde_Fecha(Fecha) || Fecha;
  }
  if (Periodo === "Mes") return Fecha.slice(0, 7);
  return Fecha;
}

function Habito_Unidad_B2(Habito: Mapa) {
  const Meta = Es_Mapa_B2(Habito.Meta) ? Habito.Meta as Mapa : {};
  if (Meta.Modo === "Tiempo") {
    return Meta.Unidad === "Horas" ? "h" : "min";
  }
  return String(Meta.Unidad || "");
}

function Obtener_Modelo_Planes_B2(Estado: Mapa) {
  if (!Es_Mapa_B2(Estado.Planes_Periodo)) return null;
  const Modelo = Estado.Planes_Periodo as Mapa;
  if (!Es_Mapa_B2(Modelo.Periodos)) {
    const Periodos_Legacy = Modelo.Version === 2
      ? {}
      : Clonar_B2(Modelo);
    Modelo.Periodos = Periodos_Legacy;
  }
  Modelo.Version = 2;
  if (!Es_Mapa_B2(Modelo.Objetivos)) Modelo.Objetivos = {};
  if (!Es_Mapa_B2(Modelo.Subobjetivos)) Modelo.Subobjetivos = {};
  if (!Es_Mapa_B2(Modelo.Partes)) Modelo.Partes = {};
  if (!Es_Mapa_B2(Modelo.Avances)) Modelo.Avances = {};
  return Modelo;
}

function Buscar_Item_Meta_B2(Modelo: Mapa, Texto: string) {
  const Items: Mapa[] = [];
  Object.values(Modelo.Objetivos as Mapa).forEach((Objetivo) => {
    if (!Es_Mapa_B2(Objetivo)) return;
    const Obj = Objetivo as Mapa;
    if (Obj.Eliminado_Local === true) return;
    Items.push({
      Tipo: "Objetivo",
      Nombre: String(Obj.Nombre || ""),
      Objetivo_Id: String(Obj.Id || ""),
      Unidad: Obj.Unidad_Custom || Obj.Unidad || "",
    });
  });
  Object.values(Modelo.Subobjetivos as Mapa).forEach((Subobj) => {
    if (!Es_Mapa_B2(Subobj)) return;
    const Sub = Subobj as Mapa;
    if (Sub.Eliminado_Local === true) return;
    Items.push({
      Tipo: "Subobjetivo",
      Nombre: String(Sub.Nombre || ""),
      Objetivo_Id: String(Sub.Objetivo_Id || ""),
      Subobjetivo_Id: String(Sub.Id || ""),
      Unidad: Sub.Unidad_Custom || Sub.Unidad || "",
    });
  });
  Object.values(Modelo.Partes as Mapa).forEach((Parte) => {
    if (!Es_Mapa_B2(Parte)) return;
    const P = Parte as Mapa;
    if (P.Eliminado_Local === true) return;
    const Sub = (Modelo.Subobjetivos as Mapa)[
      String(P.Subobjetivo_Id || "")
    ] as Mapa | undefined;
    Items.push({
      Tipo: "Parte",
      Nombre: String(P.Titulo || P.Nombre || ""),
      Objetivo_Id: String(P.Objetivo_Id || Sub?.Objetivo_Id || ""),
      Subobjetivo_Id: String(P.Subobjetivo_Id || ""),
      Parte_Id: String(P.Id || ""),
      Unidad:
        P.Unidad_Custom || P.Unidad ||
        Sub?.Unidad_Custom || Sub?.Unidad || "",
    });
  });
  return Buscar_Por_Nombre_B2(Items, Texto, "Nombre");
}

function Es_URL_Archivero_B2(Texto: string) {
  const Limpio = String(Texto || "").trim();
  if (!Limpio || /\s/.test(Limpio)) return false;
  return /^(https?:\/\/|www\.)/i.test(Limpio) ||
    /^[\w-]+\.[a-z]{2,}(\/|$)/i.test(Limpio);
}

function Resolver_Cajon_Archivero_B2(
  Archiveros: Mapa[],
  Payload: Mapa
) {
  const Cajon_Id = Leer_String_B2(
    Payload,
    "cajon_id",
    "Cajon_Id",
    "archivero_id",
    "Archivero_Id"
  );
  if (Cajon_Id && Archiveros.some((Cajon) =>
    String(Cajon.Id || "") === Cajon_Id
  )) {
    return Cajon_Id;
  }
  const Nombre = Leer_String_B2(Payload, "cajon", "Cajon");
  if (Nombre) {
    const Busqueda = Buscar_Por_Nombre_B2(
      Archiveros,
      Nombre,
      "Nombre"
    );
    if (Busqueda.Ok === true) {
      return String(Busqueda.Item.Id || "");
    }
  }
  return String(Archiveros[0]?.Id || "");
}

function Normalizar_Etiquetas_Archivero_B2(Lista: string[]) {
  const Etiquetas = new Map<string, string>();
  Lista.forEach((Etiqueta) => {
    const Limpia = String(Etiqueta || "").trim();
    if (!Limpia) return;
    const Clave = Normalizar_Texto_Busqueda(Limpia);
    if (!Etiquetas.has(Clave)) Etiquetas.set(Clave, Limpia);
  });
  return [...Etiquetas.values()].sort((A, B) =>
    A.localeCompare(B, "es", { sensitivity: "base" })
  );
}

function Normalizar_Estado_Baul_B2(Estado: string) {
  if (
    Estado === "Realizada" ||
    Estado === "Postergada" ||
    Estado === "Anulada"
  ) {
    return Estado;
  }
  return "Activa";
}

type Parametros_OAuth_Autorizar =
  | {
    Ok: true;
    Cliente_Id: string;
    Redirect_Uri: string;
    State: string;
    Scopes: string[];
  }
  | {
    Ok: false;
    Status: number;
    Error: string;
    Detalle: string;
  };

function Resolver_Parametros_OAuth_Autorizar(
  Url: URL
): Parametros_OAuth_Autorizar {
  const Config_OAuth = Obtener_Config_OAuth();
  if (!Config_OAuth.Habilitado) {
    return {
      Ok: false,
      Status: 503,
      Error: "temporarily_unavailable",
      Detalle:
        "OAuth no esta habilitado en este entorno.",
    };
  }
  const Response_Type = String(
    Url.searchParams.get("response_type") || ""
  )
    .trim()
    .toLowerCase();
  if (Response_Type !== OAUTH_RESPONSE_TYPE_CODIGO) {
    return {
      Ok: false,
      Status: 400,
      Error: "unsupported_response_type",
      Detalle:
        "Solo se admite response_type=code.",
    };
  }
  const Cliente_Id = String(
    Url.searchParams.get("client_id") || ""
  ).trim();
  if (!Cliente_Id) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_request",
      Detalle: "Falta client_id.",
    };
  }
  if (Cliente_Id !== Config_OAuth.Cliente_Id) {
    return {
      Ok: false,
      Status: 401,
      Error: "unauthorized_client",
      Detalle: "client_id invalido.",
    };
  }
  const Redirect_Uri = String(
    Url.searchParams.get("redirect_uri") || ""
  ).trim();
  if (!Redirect_Uri) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_request",
      Detalle: "Falta redirect_uri.",
    };
  }
  if (!Es_Redirect_ChatGPT_Valido(Redirect_Uri)) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_request",
      Detalle:
        "redirect_uri invalida para ChatGPT.",
    };
  }
  const State = String(
    Url.searchParams.get("state") || ""
  ).trim();
  if (!State) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_request",
      Detalle: "Falta state.",
    };
  }
  const Scope_Raw = String(
    Url.searchParams.get("scope") ||
      OAUTH_SCOPE_LECTURA
  ).trim();
  const Scopes = Normalizar_Scopes_OAuth(
    Scope_Raw
  );
  if (!Scopes.includes(OAUTH_SCOPE_LECTURA)) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_scope",
      Detalle:
        "El scope solicitado debe incluir read.",
    };
  }
  if (Hay_Scopes_OAuth_Desconocidos(Scopes)) {
    return {
      Ok: false,
      Status: 400,
      Error: "invalid_scope",
      Detalle:
        "El scope solicitado no esta soportado por Semaplan.",
    };
  }
  return {
    Ok: true,
    Cliente_Id,
    Redirect_Uri,
    State,
    Scopes,
  };
}

function Obtener_Url_Login_OAuth() {
  const Default =
    "https://semaplan.com/login.html";
  const Raw = String(
    Deno.env.get("SEMAPLAN_AI_OAUTH_LOGIN_URL") ||
      Default
  ).trim();
  try {
    return new URL(Raw).toString();
  } catch (_) {
    return Default;
  }
}

function Construir_Url_Redirect(
  Base: string,
  Parametros: Record<string, string>
) {
  const Url = new URL(Base);
  Object.entries(Parametros).forEach(
    ([Clave, Valor]) => {
      Url.searchParams.set(Clave, Valor);
    }
  );
  return Url.toString();
}

async function Crear_Codigo_OAuth_IA(
  Usuario_Id: string,
  Parametros: Extract<
    Parametros_OAuth_Autorizar,
    { Ok: true }
  >
) {
  const Codigo_Plano = Generar_Secreto_Token(
    "soac"
  );
  const Codigo_Hash = await Hash_Token(
    Codigo_Plano
  );
  const Expira_En = new Date(
    Date.now() +
      OAUTH_AUTH_CODE_EXPIRA_SEGUNDOS * 1000
  ).toISOString();
  const Supa_Servicio =
    Crear_Supabase_Servicio();
  const { error } = await Supa_Servicio
    .from("oauth_ia_codigos")
    .insert({
      usuario_id: Usuario_Id,
      cliente_id: Parametros.Cliente_Id,
      redirect_uri: Parametros.Redirect_Uri,
      scopes: Parametros.Scopes,
      code_hash: Codigo_Hash,
      expira_en: Expira_En,
    });
  if (error) {
    throw error;
  }
  return Codigo_Plano;
}

async function Procesar_OAuth_Autorizar_Post(
  Req: Request,
  Url: URL
) {
  const Parametros =
    Resolver_Parametros_OAuth_Autorizar(Url);
  if (!Parametros.Ok) {
    return Responder_OAuth_Error(
      Parametros.Status,
      Parametros.Error,
      Parametros.Detalle
    );
  }
  const Auth = await Validar_Request(Req);
  if (!Auth.Ok) {
    return Responder_OAuth_Error(
      Auth.Status,
      "access_denied",
      "No se pudo validar la sesion del usuario."
    );
  }
  try {
    const Codigo = await Crear_Codigo_OAuth_IA(
      Auth.Usuario_Id,
      Parametros
    );
    const Redirect_Url = Construir_Url_Redirect(
      Parametros.Redirect_Uri,
      {
        code: Codigo,
        state: Parametros.State,
      }
    );
    return Responder_Json({
      Ok: true,
      Redirect_Url,
    });
  } catch (Error_General) {
    console.error(
      "Error creando codigo OAuth IA:",
      Error_General
    );
    return Responder_OAuth_Error(
      500,
      "server_error",
      "No se pudo autorizar la conexion."
    );
  }
}

async function Leer_Body_Como_Form(
  Req: Request
) {
  const Contenido = String(
    Req.headers.get("content-type") || ""
  ).toLowerCase();
  if (Contenido.includes("application/json")) {
    try {
      const Json = await Req.json();
      const Form = new URLSearchParams();
      Object.entries(
        Json &&
        typeof Json === "object" &&
        !Array.isArray(Json)
          ? Json as Record<string, unknown>
          : {}
      ).forEach(([Clave, Valor]) => {
        if (Valor == null) return;
        Form.set(Clave, String(Valor));
      });
      return Form;
    } catch (_) {
      return new URLSearchParams();
    }
  }
  const Texto = await Req.text();
  return new URLSearchParams(Texto || "");
}

async function Procesar_OAuth_Token(
  Req: Request
) {
  const Config_OAuth = Obtener_Config_OAuth();
  if (!Config_OAuth.Habilitado) {
    return Responder_OAuth_Error(
      503,
      "temporarily_unavailable",
      "OAuth no esta habilitado en este entorno."
    );
  }
  const Form = await Leer_Body_Como_Form(Req);
  const Grant_Type = String(
    Form.get("grant_type") || ""
  )
    .trim()
    .toLowerCase();
  const Cliente_Id = String(
    Form.get("client_id") || ""
  ).trim();
  const Cliente_Secret = String(
    Form.get("client_secret") || ""
  ).trim();
  if (
    Cliente_Id !== Config_OAuth.Cliente_Id ||
    Cliente_Secret !== Config_OAuth.Cliente_Secret
  ) {
    return Responder_OAuth_Error(
      401,
      "invalid_client",
      "Credenciales OAuth invalidas."
    );
  }
  if (Grant_Type !== "authorization_code") {
    return Responder_OAuth_Error(
      400,
      "unsupported_grant_type",
      "Solo se admite grant_type=authorization_code."
    );
  }
  const Codigo = String(
    Form.get("code") || ""
  ).trim();
  const Redirect_Uri = String(
    Form.get("redirect_uri") || ""
  ).trim();
  if (!Codigo || !Redirect_Uri) {
    return Responder_OAuth_Error(
      400,
      "invalid_request",
      "Faltan code o redirect_uri."
    );
  }
  const Codigo_Hash = await Hash_Token(Codigo);
  const Supa_Servicio =
    Crear_Supabase_Servicio();
  const {
    data: Codigo_Registro,
    error: Error_Codigo,
  } = await Supa_Servicio
    .from("oauth_ia_codigos")
    .select(
      "id, usuario_id, cliente_id, redirect_uri, scopes, expira_en, usado_en"
    )
    .eq("code_hash", Codigo_Hash)
    .maybeSingle();
  if (Error_Codigo) {
    console.error(
      "Error leyendo codigo OAuth IA:",
      Error_Codigo
    );
    return Responder_OAuth_Error(
      500,
      "server_error",
      "No se pudo validar el codigo OAuth."
    );
  }
  if (!Codigo_Registro) {
    return Responder_OAuth_Error(
      400,
      "invalid_grant",
      "Codigo OAuth invalido."
    );
  }
  if (Codigo_Registro.usado_en) {
    return Responder_OAuth_Error(
      400,
      "invalid_grant",
      "Codigo OAuth ya utilizado."
    );
  }
  const Expira_En = Date.parse(
    String(Codigo_Registro.expira_en || "")
  );
  if (!Number.isFinite(Expira_En) || Expira_En <= Date.now()) {
    return Responder_OAuth_Error(
      400,
      "invalid_grant",
      "Codigo OAuth vencido."
    );
  }
  if (
    String(Codigo_Registro.cliente_id || "") !==
      Cliente_Id ||
    String(Codigo_Registro.redirect_uri || "") !==
      Redirect_Uri
  ) {
    return Responder_OAuth_Error(
      400,
      "invalid_grant",
      "El codigo OAuth no coincide con el cliente."
    );
  }
  const Access_Token = Generar_Secreto_Token(
    "sao"
  );
  const Access_Token_Hash = await Hash_Token(
    Access_Token
  );
  const Scopes = Array.isArray(
    Codigo_Registro.scopes
  )
    ? Codigo_Registro.scopes
      .map((Scope) =>
        String(Scope || "").trim()
      )
      .filter(Boolean)
    : [OAUTH_SCOPE_LECTURA];
  const { error: Error_Usar_Codigo } =
    await Supa_Servicio
      .from("oauth_ia_codigos")
      .update({
        usado_en: new Date().toISOString(),
      })
      .eq("id", Codigo_Registro.id)
      .is("usado_en", null);
  if (Error_Usar_Codigo) {
    console.error(
      "Error marcando codigo OAuth usado:",
      Error_Usar_Codigo
    );
    return Responder_OAuth_Error(
      500,
      "server_error",
      "No se pudo consumir el codigo OAuth."
    );
  }
  const { error: Error_Insert_Token } =
    await Supa_Servicio
      .from("tokens_ia_usuario")
      .insert({
        usuario_id: String(
          Codigo_Registro.usuario_id
        ),
        nombre: "ChatGPT OAuth",
        token_hash: Access_Token_Hash,
        scopes: Scopes,
      });
  if (Error_Insert_Token) {
    console.error(
      "Error creando token OAuth IA:",
      Error_Insert_Token
    );
    return Responder_OAuth_Error(
      500,
      "server_error",
      "No se pudo crear el token de acceso."
    );
  }
  return Responder_Json({
    access_token: Access_Token,
    token_type: "bearer",
    expires_in: OAUTH_ACCESS_TOKEN_EXPIRA_SEGUNDOS,
    scope: Scopes.join(" "),
  });
}

Deno.serve(async (Req) => {
  if (Req.method === "OPTIONS") {
    return new Response("ok", {
      headers: Cors_Headers,
    });
  }

  const Ruta = Obtener_Ruta_Relativa(Req);
  const Url = new URL(Req.url);

  if (Req.method === "GET" && Ruta === "/salud") {
    return Responder_Json({
      Ok: true,
      Servicio: "Semaplan AI Gateway",
      Version: "2.0.0",
    });
  }

  if (
    Req.method === "GET" &&
    Ruta === "/openapi.json"
  ) {
    return Responder_Json(
      Construir_OpenAPI_Semaplan_IA(
        Obtener_Url_Base_Gateway(Req)
      )
    );
  }

  if (
    Req.method === "GET" &&
    Ruta === "/openapi-key.json"
  ) {
    return Responder_Json(
      Construir_OpenAPI_Semaplan_IA(
        Obtener_Url_Base_Gateway(Req),
        "api_key",
        false
      )
    );
  }

  if (
    Req.method === "GET" &&
    Ruta === "/oauth/authorize"
  ) {
    const Parametros =
      Resolver_Parametros_OAuth_Autorizar(Url);
    if (!Parametros.Ok) {
      return Responder_OAuth_Error(
        Parametros.Status,
        Parametros.Error,
        Parametros.Detalle
      );
    }
    const Login_Url = Construir_Url_Redirect(
      Obtener_Url_Login_OAuth(),
      {
        oauth_ia: "1",
        response_type: OAUTH_RESPONSE_TYPE_CODIGO,
        client_id: Parametros.Cliente_Id,
        redirect_uri: Parametros.Redirect_Uri,
        scope: Parametros.Scopes.join(" "),
        state: Parametros.State,
      }
    );
    return Response.redirect(Login_Url, 302);
  }

  if (
    Req.method === "POST" &&
    Ruta === "/oauth/authorize"
  ) {
    return await Procesar_OAuth_Autorizar_Post(
      Req,
      Url
    );
  }

  if (
    Req.method === "POST" &&
    Ruta === "/oauth/token"
  ) {
    return await Procesar_OAuth_Token(Req);
  }

  if (
    Req.method === "POST" &&
    Ruta === "/b2/tareas/lote"
  ) {
    const Auth = await Validar_Request(Req);
    if (!Auth.Ok) return Responder_Error(Auth.Status, Auth.Error, Auth.Detalle);
    return await Responder_Lote_Tareas_B2(Req, Auth);
  }

  if (
    Req.method === "POST" &&
    Ruta === "/b2/lote"
  ) {
    const Auth = await Validar_Request(Req);
    if (!Auth.Ok) return Responder_Error(Auth.Status, Auth.Error, Auth.Detalle);
    return await Responder_Lote_Operaciones_B2(Req, Auth);
  }

  if (
    Req.method === "POST" &&
    Ruta === "/b2/deshacer"
  ) {
    const Auth = await Validar_Request(Req);
    if (!Auth.Ok) return Responder_Error(Auth.Status, Auth.Error, Auth.Detalle);
    return await Responder_Deshacer_B2(Req, Auth);
  }

  const Ruta_B2 = Rutas_B2[Ruta];
  if (Ruta_B2) {
    if (Req.method !== "POST") {
      return Responder_Error(
        405,
        "Metodo no permitido",
        "Esta ruta B2 solo acepta POST."
      );
    }
    const Auth = await Validar_Request(Req);
    if (!Auth.Ok) {
      return Responder_Error(
        Auth.Status,
        Auth.Error,
        Auth.Detalle
      );
    }
    return await Responder_B2(Req, Auth, Ruta_B2);
  }

  const Rutas_Reservadas = new Set([
    "/contexto",
    "/agenda",
    "/tareas",
    "/habitos",
    "/slots",
    "/planes/semana",
    "/planes/periodos",
    "/metas",
    "/archivero",
    "/archivero/buscar",
    "/baul",
    "/buscar",
    "/resumen",
    "/diagnostico/planes",
    "/historial",
  ]);

  if (Rutas_Reservadas.has(Ruta)) {
    const Auth = await Validar_Request(Req);
    if (!Auth.Ok) {
      return Responder_Error(
        Auth.Status,
        Auth.Error,
        Auth.Detalle
      );
    }

    const Estado = await Leer_Estado_Usuario(
      Auth.Usuario_Id
    );
    if (!Estado.Ok) {
      return Responder_Error(
        Estado.Status,
        Estado.Error,
        Estado.Detalle
      );
    }

    if (Req.method !== "GET") {
      return Responder_Error(
        405,
        "Metodo no permitido",
        "Esta ruta por ahora solo acepta GET."
      );
    }

    if (Ruta === "/agenda") {
      return Responder_Agenda(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/contexto") {
      return Responder_Contexto(
        Estado.Estado,
        Estado.Version,
        Estado.Actualizado_En,
        Url
      );
    }

    if (Ruta === "/tareas") {
      return Responder_Tareas(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/habitos") {
      return Responder_Habitos(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/slots") {
      return Responder_Slots(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/planes/semana") {
      return Responder_Planes_Semana(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/planes/periodos") {
      return Responder_Planes_Periodos(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/metas") {
      return Responder_Metas_Compatibilidad(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/archivero") {
      return Responder_Archivero(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/archivero/buscar") {
      return Responder_Archivero_Buscar(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/baul") {
      return Responder_Baul(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/buscar") {
      return Responder_Busqueda_Global(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/resumen") {
      return Responder_Resumen_Operativo(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/diagnostico/planes") {
      return Responder_Diagnostico_Planes(
        Estado.Estado,
        Url
      );
    }

    if (Ruta === "/historial") {
      return await Responder_Historial_Chat(
        Auth.Usuario_Id,
        Url
      );
    }

    // TODO: Fase posterior.
    // Agregar rate limit por token antes de abrir
    // la API en produccion.
    return Responder_Error(
      501,
      "No implementado",
      "La fase actual expone /salud, " +
        "/agenda, /contexto, /tareas, /habitos, " +
        "/slots, /planes/semana, /planes/periodos, " +
        "/archivero, /archivero/buscar, /baul, /buscar, " +
        "/resumen, /diagnostico/planes y /historial, " +
        "/openapi.json " +
        "y lectura segura del estado."
    );
  }

  return Responder_Error(
    404,
    "Ruta inexistente",
    `No existe la ruta ${Ruta}.`
  );
});
