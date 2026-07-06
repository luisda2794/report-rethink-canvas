export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      borrador_lineas: {
        Row: {
          borrador_id: string
          cantidad: number
          codigo_postal: string
          created_at: string
          id: string
          precio_unitario: number
          subtotal: number
          tipo_entrega: string
        }
        Insert: {
          borrador_id: string
          cantidad?: number
          codigo_postal: string
          created_at?: string
          id?: string
          precio_unitario?: number
          subtotal?: number
          tipo_entrega: string
        }
        Update: {
          borrador_id?: string
          cantidad?: number
          codigo_postal?: string
          created_at?: string
          id?: string
          precio_unitario?: number
          subtotal?: number
          tipo_entrega?: string
        }
        Relationships: [
          {
            foreignKeyName: "borrador_lineas_borrador_id_fkey"
            columns: ["borrador_id"]
            isOneToOne: false
            referencedRelation: "borradores"
            referencedColumns: ["id"]
          },
        ]
      }
      borradores: {
        Row: {
          base_imponible: number
          created_at: string
          created_by: string | null
          driver_nombre: string
          estado: string
          fecha_desde: string
          fecha_hasta: string
          hub_id: string
          id: string
          iva_21: number
          total: number
          total_paquetes: number
          updated_at: string
        }
        Insert: {
          base_imponible?: number
          created_at?: string
          created_by?: string | null
          driver_nombre: string
          estado?: string
          fecha_desde: string
          fecha_hasta: string
          hub_id: string
          id?: string
          iva_21?: number
          total?: number
          total_paquetes?: number
          updated_at?: string
        }
        Update: {
          base_imponible?: number
          created_at?: string
          created_by?: string | null
          driver_nombre?: string
          estado?: string
          fecha_desde?: string
          fecha_hasta?: string
          hub_id?: string
          id?: string
          iva_21?: number
          total?: number
          total_paquetes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "borradores_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      cd5_snapshots: {
        Row: {
          count: number
          cp: string
          provincia: string
          updated_at: string
        }
        Insert: {
          count?: number
          cp: string
          provincia: string
          updated_at?: string
        }
        Update: {
          count?: number
          cp?: string
          provincia?: string
          updated_at?: string
        }
        Relationships: []
      }
      conciliacion: {
        Row: {
          cp: string | null
          created_at: string
          driver: string | null
          factura_id: string | null
          fecha: string | null
          hub_id: string
          id: string
          importe: number
          lp_no: string
          pagado: boolean
          tipo: string | null
          waybill: string | null
        }
        Insert: {
          cp?: string | null
          created_at?: string
          driver?: string | null
          factura_id?: string | null
          fecha?: string | null
          hub_id: string
          id?: string
          importe?: number
          lp_no: string
          pagado?: boolean
          tipo?: string | null
          waybill?: string | null
        }
        Update: {
          cp?: string | null
          created_at?: string
          driver?: string | null
          factura_id?: string | null
          fecha?: string | null
          hub_id?: string
          id?: string
          importe?: number
          lp_no?: string
          pagado?: boolean
          tipo?: string | null
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliacion_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas_cainiao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacion_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_tarifas: {
        Row: {
          codigo_postal: string
          created_at: string
          hub_id: string
          id: string
          precio_aa: number
          precio_door: number
          precio_pudo: number
          updated_at: string
          vigente_desde: string
        }
        Insert: {
          codigo_postal: string
          created_at?: string
          hub_id: string
          id?: string
          precio_aa?: number
          precio_door?: number
          precio_pudo?: number
          updated_at?: string
          vigente_desde?: string
        }
        Update: {
          codigo_postal?: string
          created_at?: string
          hub_id?: string
          id?: string
          precio_aa?: number
          precio_door?: number
          precio_pudo?: number
          updated_at?: string
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_tarifas_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      entregas: {
        Row: {
          contacto: string | null
          cp: string | null
          created_at: string
          direccion: string | null
          driver: string | null
          epod_upload_id: string | null
          es_aa: boolean
          estado: string
          fecha: string | null
          fecha_inbound: string | null
          hub_id: string
          id: string
          lp_no: string
          pop_station_id: string | null
          source: string | null
          tipo: string | null
          tipo_norm: string | null
          updated_at: string
          waybill: string | null
        }
        Insert: {
          contacto?: string | null
          cp?: string | null
          created_at?: string
          direccion?: string | null
          driver?: string | null
          epod_upload_id?: string | null
          es_aa?: boolean
          estado?: string
          fecha?: string | null
          fecha_inbound?: string | null
          hub_id: string
          id?: string
          lp_no: string
          pop_station_id?: string | null
          source?: string | null
          tipo?: string | null
          tipo_norm?: string | null
          updated_at?: string
          waybill?: string | null
        }
        Update: {
          contacto?: string | null
          cp?: string | null
          created_at?: string
          direccion?: string | null
          driver?: string | null
          epod_upload_id?: string | null
          es_aa?: boolean
          estado?: string
          fecha?: string | null
          fecha_inbound?: string | null
          hub_id?: string
          id?: string
          lp_no?: string
          pop_station_id?: string | null
          source?: string | null
          tipo?: string | null
          tipo_norm?: string | null
          updated_at?: string
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entregas_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      epod_uploads: {
        Row: {
          created_at: string
          fecha_epod: string | null
          filename: string
          hub_id: string
          id: string
          procesado: boolean
          total_duplicados: number
          total_entregados: number
          total_paquetes: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fecha_epod?: string | null
          filename: string
          hub_id: string
          id?: string
          procesado?: boolean
          total_duplicados?: number
          total_entregados?: number
          total_paquetes?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fecha_epod?: string | null
          filename?: string
          hub_id?: string
          id?: string
          procesado?: boolean
          total_duplicados?: number
          total_entregados?: number
          total_paquetes?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "epod_uploads_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas_cainiao: {
        Row: {
          bill_id: string | null
          created_at: string
          fecha_factura: string | null
          filename: string | null
          hub_id: string
          id: string
          importe_estimado_no_cobrado: number
          importe_total: number
          no_pagados: number
          pagados: number
          total_paquetes: number
          user_id: string | null
        }
        Insert: {
          bill_id?: string | null
          created_at?: string
          fecha_factura?: string | null
          filename?: string | null
          hub_id: string
          id?: string
          importe_estimado_no_cobrado?: number
          importe_total?: number
          no_pagados?: number
          pagados?: number
          total_paquetes?: number
          user_id?: string | null
        }
        Update: {
          bill_id?: string | null
          created_at?: string
          fecha_factura?: string | null
          filename?: string | null
          hub_id?: string
          id?: string
          importe_estimado_no_cobrado?: number
          importe_total?: number
          no_pagados?: number
          pagados?: number
          total_paquetes?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_cainiao_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      hubs: {
        Row: {
          activo: boolean
          ciudad: string | null
          created_at: string
          id: string
          marca: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          ciudad?: string | null
          created_at?: string
          id?: string
          marca: string
          nombre: string
        }
        Update: {
          activo?: boolean
          ciudad?: string | null
          created_at?: string
          id?: string
          marca?: string
          nombre?: string
        }
        Relationships: []
      }
      mapa_cp_data: {
        Row: {
          cp: string
          dsp: string | null
          hub_id: string | null
          id: string
          sla_fijo: string | null
          sla_teorico: string | null
          updated_at: string
          version_id: string
          volumen: number | null
        }
        Insert: {
          cp: string
          dsp?: string | null
          hub_id?: string | null
          id?: string
          sla_fijo?: string | null
          sla_teorico?: string | null
          updated_at?: string
          version_id: string
          volumen?: number | null
        }
        Update: {
          cp?: string
          dsp?: string | null
          hub_id?: string | null
          id?: string
          sla_fijo?: string | null
          sla_teorico?: string | null
          updated_at?: string
          version_id?: string
          volumen?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mapa_cp_data_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapa_cp_data_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "mapa_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mapa_versions: {
        Row: {
          activa: boolean
          creado_por: string
          created_at: string
          geojson_path: string
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          creado_por?: string
          created_at?: string
          geojson_path: string
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          creado_por?: string
          created_at?: string
          geojson_path?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          activo: boolean
          created_at: string
          full_name: string | null
          hub_id: string | null
          id: string
          role: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          full_name?: string | null
          hub_id?: string | null
          id: string
          role?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          full_name?: string | null
          hub_id?: string | null
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      reclamaciones: {
        Row: {
          comentarios: string | null
          cp: string | null
          created_at: string
          created_by: string | null
          driver_nombre: string | null
          driver_telefono: string | null
          estado: string
          evidencia: string | null
          evidencia_driver: string | null
          fecha_entrega: string | null
          fecha_envio_whatsapp: string | null
          fecha_respuesta: string | null
          hub_id: string
          id: string
          importe: number | null
          lp_no: string | null
          nombre_driver_resp: string | null
          ref: string
          respuesta_driver: string | null
          tipo: string
          token: string
          updated_at: string
          waybill: string | null
        }
        Insert: {
          comentarios?: string | null
          cp?: string | null
          created_at?: string
          created_by?: string | null
          driver_nombre?: string | null
          driver_telefono?: string | null
          estado?: string
          evidencia?: string | null
          evidencia_driver?: string | null
          fecha_entrega?: string | null
          fecha_envio_whatsapp?: string | null
          fecha_respuesta?: string | null
          hub_id: string
          id?: string
          importe?: number | null
          lp_no?: string | null
          nombre_driver_resp?: string | null
          ref?: string
          respuesta_driver?: string | null
          tipo: string
          token?: string
          updated_at?: string
          waybill?: string | null
        }
        Update: {
          comentarios?: string | null
          cp?: string | null
          created_at?: string
          created_by?: string | null
          driver_nombre?: string | null
          driver_telefono?: string | null
          estado?: string
          evidencia?: string | null
          evidencia_driver?: string | null
          fecha_entrega?: string | null
          fecha_envio_whatsapp?: string | null
          fecha_respuesta?: string | null
          hub_id?: string
          id?: string
          importe?: number | null
          lp_no?: string | null
          nombre_driver_resp?: string | null
          ref?: string
          respuesta_driver?: string | null
          tipo?: string
          token?: string
          updated_at?: string
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reclamaciones_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      usuario_hubs: {
        Row: {
          created_at: string
          hub_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hub_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hub_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuario_hubs_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "hubs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: { Args: { _user_id: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      refresh_cd5_snapshots: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
