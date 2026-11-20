// Archivo generado por `npm run db:types` a partir de supabase/migrations. No lo edites a mano:
// cambia el esquema con una migración y vuelve a generarlo. El CI comprueba que coincide con las
// migraciones (npm run db:types:check). Los alias para el resto de la app están en database.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      genera: {
        Row: {
          created_at: string
          id: string
          is_quick_access: boolean
          name: string
          photo_path: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_quick_access?: boolean
          name: string
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_quick_access?: boolean
          name?: string
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      genus_abbreviations: {
        Row: {
          abbreviation: string
          created_at: string
          genus_id: string
          id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          abbreviation: string
          created_at?: string
          genus_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          created_at?: string
          genus_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'genus_abbreviations_genus_id_fkey'
            columns: ['genus_id']
            isOneToOne: false
            referencedRelation: 'genera'
            referencedColumns: ['id']
          },
        ]
      }
      plants: {
        Row: {
          acquired_on: string
          created_at: string
          entered_name: string
          flower_color: Database['public']['Enums']['flower_color'] | null
          genus_id: string
          id: string
          location: string | null
          nickname: string | null
          origin: string | null
          photo_in_bloom: boolean
          photo_path: string | null
          species_id: string | null
          status: Database['public']['Enums']['plant_status']
          thumbnail_path: string | null
          type: Database['public']['Enums']['plant_type']
          updated_at: string
          user_id: string
          validation: Database['public']['Enums']['plant_validation']
        }
        ComputedFields: never
        Insert: {
          acquired_on?: string
          created_at?: string
          entered_name: string
          flower_color?: Database['public']['Enums']['flower_color'] | null
          genus_id: string
          id?: string
          location?: string | null
          nickname?: string | null
          origin?: string | null
          photo_in_bloom?: boolean
          photo_path?: string | null
          species_id?: string | null
          status?: Database['public']['Enums']['plant_status']
          thumbnail_path?: string | null
          type: Database['public']['Enums']['plant_type']
          updated_at?: string
          user_id?: string
          validation?: Database['public']['Enums']['plant_validation']
        }
        Update: {
          acquired_on?: string
          created_at?: string
          entered_name?: string
          flower_color?: Database['public']['Enums']['flower_color'] | null
          genus_id?: string
          id?: string
          location?: string | null
          nickname?: string | null
          origin?: string | null
          photo_in_bloom?: boolean
          photo_path?: string | null
          species_id?: string | null
          status?: Database['public']['Enums']['plant_status']
          thumbnail_path?: string | null
          type?: Database['public']['Enums']['plant_type']
          updated_at?: string
          user_id?: string
          validation?: Database['public']['Enums']['plant_validation']
        }
        Relationships: [
          {
            foreignKeyName: 'plants_genus_id_fkey'
            columns: ['genus_id']
            isOneToOne: false
            referencedRelation: 'genera'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'plants_species_id_fkey'
            columns: ['species_id']
            isOneToOne: false
            referencedRelation: 'species'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          preferred_language: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          preferred_language?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          preferred_language?: string
          updated_at?: string
        }
        Relationships: []
      }
      species: {
        Row: {
          created_at: string
          genus_id: string
          id: string
          scientific_name: string
          source: Database['public']['Enums']['species_source']
          source_ref: string | null
          status: Database['public']['Enums']['species_status']
          type: Database['public']['Enums']['species_type']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          genus_id: string
          id?: string
          scientific_name: string
          source: Database['public']['Enums']['species_source']
          source_ref?: string | null
          status: Database['public']['Enums']['species_status']
          type: Database['public']['Enums']['species_type']
          updated_at?: string
        }
        Update: {
          created_at?: string
          genus_id?: string
          id?: string
          scientific_name?: string
          source?: Database['public']['Enums']['species_source']
          source_ref?: string | null
          status?: Database['public']['Enums']['species_status']
          type?: Database['public']['Enums']['species_type']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'species_genus_id_fkey'
            columns: ['genus_id']
            isOneToOne: false
            referencedRelation: 'genera'
            referencedColumns: ['id']
          },
        ]
      }
      species_names: {
        Row: {
          created_at: string
          id: string
          language: string | null
          name: string
          species_id: string
          type: Database['public']['Enums']['species_name_type']
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          language?: string | null
          name: string
          species_id: string
          type: Database['public']['Enums']['species_name_type']
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string | null
          name?: string
          species_id?: string
          type?: Database['public']['Enums']['species_name_type']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'species_names_species_id_fkey'
            columns: ['species_id']
            isOneToOne: false
            referencedRelation: 'species'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_catalog_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      requesting_user_id: { Args: Record<PropertyKey, never>; Returns: string }
    }
    Enums: {
      flower_color:
        'white' | 'pink' | 'purple' | 'yellow' | 'orange' | 'bicolor'
      plant_status: 'active' | 'lost' | 'gifted'
      plant_type: 'species' | 'hybrid' | 'unknown'
      plant_validation: 'pending' | 'validated' | 'unidentifiable'
      species_name_type: 'synonym' | 'common'
      species_source: 'gbif' | 'curated' | 'user_proposal'
      species_status: 'imported' | 'validated' | 'observed'
      species_type: 'species' | 'hybrid'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      flower_color: ['white', 'pink', 'purple', 'yellow', 'orange', 'bicolor'],
      plant_status: ['active', 'lost', 'gifted'],
      plant_type: ['species', 'hybrid', 'unknown'],
      plant_validation: ['pending', 'validated', 'unidentifiable'],
      species_name_type: ['synonym', 'common'],
      species_source: ['gbif', 'curated', 'user_proposal'],
      species_status: ['imported', 'validated', 'observed'],
      species_type: ['species', 'hybrid'],
    },
  },
} as const
