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
      catalog_audit_log: {
        Row: {
          action: string
          action_id: string
          actor: string
          created_at: string
          details: Json | null
          id: number
          new_values: Json | null
          old_values: Json | null
          row_id: string | null
          species_id: string | null
          table_name: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          action_id: string
          actor: string
          created_at?: string
          details?: Json | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          row_id?: string | null
          species_id?: string | null
          table_name?: string | null
        }
        Update: {
          action?: string
          action_id?: string
          actor?: string
          created_at?: string
          details?: Json | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          row_id?: string | null
          species_id?: string | null
          table_name?: string | null
        }
        Relationships: []
      }
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
      plant_photos: {
        Row: {
          created_at: string
          id: string
          in_bloom: boolean
          note: string | null
          photo_path: string
          plant_id: string
          position: number
          taken_at: string | null
          thumbnail_path: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          in_bloom?: boolean
          note?: string | null
          photo_path: string
          plant_id: string
          position: number
          taken_at?: string | null
          thumbnail_path: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          in_bloom?: boolean
          note?: string | null
          photo_path?: string
          plant_id?: string
          position?: number
          taken_at?: string | null
          thumbnail_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'plant_photos_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plants'
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
      product_events: {
        Row: {
          duration_ms: number
          generated_offline: boolean
          has_photo: boolean | null
          id: string
          name_pending: boolean | null
          occurred_at: string
          received_at: string
          result: Database['public']['Enums']['product_event_result'] | null
          type: Database['public']['Enums']['product_event_type']
          user_id: string
        }
        ComputedFields: never
        Insert: {
          duration_ms: number
          generated_offline: boolean
          has_photo?: boolean | null
          id: string
          name_pending?: boolean | null
          occurred_at: string
          received_at?: string
          result?: Database['public']['Enums']['product_event_result'] | null
          type: Database['public']['Enums']['product_event_type']
          user_id?: string
        }
        Update: {
          duration_ms?: number
          generated_offline?: boolean
          has_photo?: boolean | null
          id?: string
          name_pending?: boolean | null
          occurred_at?: string
          received_at?: string
          result?: Database['public']['Enums']['product_event_result'] | null
          type?: Database['public']['Enums']['product_event_type']
          user_id?: string
        }
        Relationships: []
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
      species_merge_keys: {
        Row: {
          action_id: string
          merged_at: string
          merged_by: string
          merged_scientific_name: string
          merged_species_id: string
          source: Database['public']['Enums']['species_source']
          source_ref: string
          species_id: string
        }
        ComputedFields: never
        Insert: {
          action_id: string
          merged_at?: string
          merged_by: string
          merged_scientific_name: string
          merged_species_id: string
          source: Database['public']['Enums']['species_source']
          source_ref: string
          species_id: string
        }
        Update: {
          action_id?: string
          merged_at?: string
          merged_by?: string
          merged_scientific_name?: string
          merged_species_id?: string
          source?: Database['public']['Enums']['species_source']
          source_ref?: string
          species_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'species_merge_keys_species_id_fkey'
            columns: ['species_id']
            isOneToOne: false
            referencedRelation: 'species'
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
      add_genus_abbreviation: {
        Args: { new_abbreviation: string; target_genus_id: string }
        Returns: {
          abbreviation: string
          created_at: string
          genus_id: string
          id: string
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'genus_abbreviations'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_species_name: {
        Args: {
          new_language?: string
          new_name: string
          new_type: Database['public']['Enums']['species_name_type']
          target_species_id: string
        }
        Returns: {
          created_at: string
          id: string
          language: string | null
          name: string
          species_id: string
          type: Database['public']['Enums']['species_name_type']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'species_names'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      catalog_summary: {
        Args: Record<PropertyKey, never>
        Returns: {
          col_source_count: number
          common_name_count: number
          curated_source_count: number
          gbif_source_count: number
          genus_count: number
          hybrid_count: number
          imported_count: number
          observed_count: number
          species_count: number
          synonym_count: number
          user_proposal_source_count: number
          validated_count: number
        }[]
      }
      count_proposal_groups: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      count_species_plants: {
        Args: { target_species_id: string }
        Returns: number
      }
      create_catalog_genus: {
        Args: { new_is_quick_access?: boolean; new_name: string }
        Returns: {
          created_at: string
          id: string
          is_quick_access: boolean
          name: string
          photo_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'genera'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_catalog_species: {
        Args: {
          new_genus_id: string
          new_scientific_name: string
          new_status?: Database['public']['Enums']['species_status']
          new_type: Database['public']['Enums']['species_type']
        }
        Returns: {
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
        SetofOptions: {
          from: '*'
          to: 'species'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_species_from_proposal: {
        Args: {
          group_genus_id: string
          group_name_key: string
          new_genus_id: string
          new_scientific_name: string
          new_type: Database['public']['Enums']['species_type']
        }
        Returns: {
          action_id: string
          plant_count: number
          species_id: string
        }[]
      }
      delete_catalog_genus: {
        Args: { target_genus_id: string }
        Returns: undefined
      }
      delete_catalog_species: {
        Args: { target_species_id: string }
        Returns: undefined
      }
      delete_genus_abbreviation: {
        Args: { target_abbreviation_id: string }
        Returns: undefined
      }
      delete_species_name: {
        Args: { target_name_id: string }
        Returns: undefined
      }
      is_catalog_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_pending_plant: { Args: { target_plant_id: string }; Returns: boolean }
      is_pending_plant_photo: {
        Args: { object_name: string }
        Returns: boolean
      }
      link_proposal_group: {
        Args: {
          group_genus_id: string
          group_name_key: string
          target_species_id: string
        }
        Returns: {
          action_id: string
          plant_count: number
        }[]
      }
      list_catalog_genera: {
        Args: {
          page_number?: number
          page_size?: number
          query?: string
          quick_access_only?: boolean
        }
        Returns: {
          abbreviations: string[]
          current_page: number
          id: string
          is_quick_access: boolean
          name: string
          species_count: number
          total_count: number
        }[]
      }
      list_catalog_species: {
        Args: {
          after_id?: string
          before_id?: string
          filter_genus_id?: string
          filter_source?: Database['public']['Enums']['species_source']
          filter_status?: Database['public']['Enums']['species_status']
          filter_type?: Database['public']['Enums']['species_type']
          last_page?: boolean
          page_size?: number
        }
        Returns: {
          common_name_count: number
          created_at: string
          genus_id: string
          genus_name: string
          has_next: boolean
          has_previous: boolean
          id: string
          scientific_name: string
          source: Database['public']['Enums']['species_source']
          source_ref: string
          status: Database['public']['Enums']['species_status']
          synonym_count: number
          total_count: number
          type: Database['public']['Enums']['species_type']
          updated_at: string
        }[]
      }
      list_proposal_groups: {
        Args: { page_offset?: number; page_size?: number }
        Returns: {
          genus_id: string
          genus_name: string
          name_key: string
          photos: Json
          plant_count: number
          proposed_name: string
          total_count: number
          type: Database['public']['Enums']['plant_type']
        }[]
      }
      mark_proposal_unidentifiable: {
        Args: { group_genus_id: string; group_name_key: string }
        Returns: {
          action_id: string
          plant_count: number
        }[]
      }
      merge_species: {
        Args: { kept_species_id: string; merged_species_id: string }
        Returns: {
          action_id: string
          kept_validated: boolean
          moved_name_count: number
          plant_count: number
          remembered_keys: Json
          skipped_name_count: number
        }[]
      }
      normalize_search_text: { Args: { value: string }; Returns: string }
      preview_species_merge: {
        Args: { kept_species_id: string; merged_species_id: string }
        Returns: {
          existing_names: Json
          genus_differs: boolean
          kept_becomes_validated: boolean
          kept_genus_id: string
          kept_genus_name: string
          kept_scientific_name: string
          kept_status: Database['public']['Enums']['species_status']
          kept_type: Database['public']['Enums']['species_type']
          merged_genus_id: string
          merged_genus_name: string
          merged_scientific_name: string
          merged_source: Database['public']['Enums']['species_source']
          merged_source_ref: string
          merged_status: Database['public']['Enums']['species_status']
          merged_type: Database['public']['Enums']['species_type']
          moved_names: Json
          plant_count: number
          remembered_keys: Json
          type_differs: boolean
        }[]
      }
      record_product_events: { Args: { events: Json }; Returns: undefined }
      requesting_user_id: { Args: Record<PropertyKey, never>; Returns: string }
      search_catalog_species: {
        Args: {
          filter_genus_id?: string
          filter_source?: Database['public']['Enums']['species_source']
          filter_status?: Database['public']['Enums']['species_status']
          filter_type?: Database['public']['Enums']['species_type']
          page_number?: number
          page_size?: number
          query: string
        }
        Returns: {
          common_name_count: number
          created_at: string
          current_page: number
          genus_id: string
          genus_name: string
          id: string
          matched_name: string
          matched_name_type: Database['public']['Enums']['species_match_type']
          scientific_name: string
          source: Database['public']['Enums']['species_source']
          source_ref: string
          status: Database['public']['Enums']['species_status']
          synonym_count: number
          total_count: number
          type: Database['public']['Enums']['species_type']
          updated_at: string
        }[]
      }
      search_genera: {
        Args: { max_results?: number; query: string }
        Returns: {
          id: string
          is_quick_access: boolean
          matched_abbreviation: string
          name: string
        }[]
      }
      search_species: {
        Args: { max_results?: number; query: string }
        Returns: {
          genus_id: string
          genus_name: string
          id: string
          matched_name: string
          matched_name_type: Database['public']['Enums']['species_match_type']
          scientific_name: string
          status: Database['public']['Enums']['species_status']
          type: Database['public']['Enums']['species_type']
        }[]
      }
      set_catalog_species_status: {
        Args: {
          new_status: Database['public']['Enums']['species_status']
          target_species_ids: string[]
        }
        Returns: number
      }
      species_history: {
        Args: {
          before_entry_id?: number
          page_size?: number
          target_species_id: string
        }
        Returns: {
          action: string
          action_id: string
          actor: string
          changes: Json
          created_at: string
          details: Json
          entry_id: number
          genus_names: Json
          has_more: boolean
          other_change_count: number
        }[]
      }
      update_catalog_genus: {
        Args: {
          new_is_quick_access: boolean
          new_name: string
          target_genus_id: string
        }
        Returns: {
          created_at: string
          id: string
          is_quick_access: boolean
          name: string
          photo_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'genera'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_catalog_species: {
        Args: {
          new_genus_id: string
          new_scientific_name: string
          new_status: Database['public']['Enums']['species_status']
          new_type: Database['public']['Enums']['species_type']
          target_species_id: string
        }
        Returns: {
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
        SetofOptions: {
          from: '*'
          to: 'species'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_genus_abbreviation: {
        Args: { new_abbreviation: string; target_abbreviation_id: string }
        Returns: {
          abbreviation: string
          created_at: string
          genus_id: string
          id: string
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'genus_abbreviations'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_species_name: {
        Args: {
          new_language?: string
          new_name: string
          new_type: Database['public']['Enums']['species_name_type']
          target_name_id: string
        }
        Returns: {
          created_at: string
          id: string
          language: string | null
          name: string
          species_id: string
          type: Database['public']['Enums']['species_name_type']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'species_names'
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      flower_color:
        'white' | 'pink' | 'purple' | 'yellow' | 'orange' | 'bicolor'
      plant_status: 'active' | 'lost' | 'gifted'
      plant_type: 'species' | 'hybrid' | 'unknown'
      plant_validation: 'pending' | 'validated' | 'unidentifiable'
      product_event_result: 'owned' | 'not_owned' | 'similar'
      product_event_type: 'plant_registered' | 'have_it_search'
      species_match_type: 'scientific' | 'synonym' | 'common'
      species_name_type: 'synonym' | 'common'
      species_source: 'gbif' | 'curated' | 'user_proposal' | 'col'
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
      product_event_result: ['owned', 'not_owned', 'similar'],
      product_event_type: ['plant_registered', 'have_it_search'],
      species_match_type: ['scientific', 'synonym', 'common'],
      species_name_type: ['synonym', 'common'],
      species_source: ['gbif', 'curated', 'user_proposal', 'col'],
      species_status: ['imported', 'validated', 'observed'],
      species_type: ['species', 'hybrid'],
    },
  },
} as const
