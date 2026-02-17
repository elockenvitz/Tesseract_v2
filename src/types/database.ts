export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      asset_notes: {
        Row: {
          id: string
          asset_id: string
          title: string
          content: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared: boolean | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          is_deleted: boolean | null
        }
        Insert: {
          id?: string
          asset_id: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
        Update: {
          id?: string
          asset_id?: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
      }
      portfolio_notes: {
        Row: {
          id: string
          portfolio_id: string
          title: string
          content: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared: boolean | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          is_deleted: boolean | null
        }
        Insert: {
          id?: string
          portfolio_id: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
        Update: {
          id?: string
          portfolio_id?: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
      }
      theme_notes: {
        Row: {
          id: string
          theme_id: string
          title: string
          content: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared: boolean | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          is_deleted: boolean | null
        }
        Insert: {
          id?: string
          theme_id: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
        Update: {
          id?: string
          theme_id?: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
      }
      custom_notebook_notes: {
        Row: {
          id: string
          custom_notebook_id: string
          title: string
          content: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared: boolean | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          is_deleted: boolean | null
        }
        Insert: {
          id?: string
          custom_notebook_id: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
        Update: {
          id?: string
          custom_notebook_id?: string
          title?: string
          content?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general' | null
          is_shared?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          is_deleted?: boolean | null
        }
      }
      custom_notebooks: {
        Row: {
          id: string
          name: string
          description: string | null
          color: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          color?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          color?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
      }
      asset_lists: {
        Row: {
          id: string
          name: string
          description: string | null
          color: string | null
          is_default: boolean | null
          list_type: 'mutual' | 'collaborative'
          portfolio_id: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          color?: string | null
          is_default?: boolean | null
          list_type?: 'mutual' | 'collaborative'
          portfolio_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          color?: string | null
          is_default?: boolean | null
          list_type?: 'mutual' | 'collaborative'
          portfolio_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
      }
      asset_list_activity: {
        Row: {
          id: string
          list_id: string
          actor_id: string | null
          activity_type: 'item_added' | 'item_removed' | 'metadata_updated' | 'collaborator_added' | 'collaborator_removed'
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          list_id: string
          actor_id?: string | null
          activity_type: 'item_added' | 'item_removed' | 'metadata_updated' | 'collaborator_added' | 'collaborator_removed'
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          list_id?: string
          actor_id?: string | null
          activity_type?: 'item_added' | 'item_removed' | 'metadata_updated' | 'collaborator_added' | 'collaborator_removed'
          metadata?: Record<string, unknown>
          created_at?: string
        }
      }
      asset_list_user_state: {
        Row: {
          list_id: string
          user_id: string
          last_opened_at: string
        }
        Insert: {
          list_id: string
          user_id: string
          last_opened_at?: string
        }
        Update: {
          list_id?: string
          user_id?: string
          last_opened_at?: string
        }
      }
      asset_list_suggestions: {
        Row: {
          id: string
          list_id: string
          asset_id: string
          suggestion_type: 'add' | 'remove'
          suggested_by: string
          target_user_id: string
          status: 'pending' | 'accepted' | 'rejected'
          notes: string | null
          created_at: string | null
          responded_at: string | null
          response_notes: string | null
        }
        Insert: {
          id?: string
          list_id: string
          asset_id: string
          suggestion_type: 'add' | 'remove'
          suggested_by: string
          target_user_id: string
          status?: 'pending' | 'accepted' | 'rejected'
          notes?: string | null
          created_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
        }
        Update: {
          id?: string
          list_id?: string
          asset_id?: string
          suggestion_type?: 'add' | 'remove'
          suggested_by?: string
          target_user_id?: string
          status?: 'pending' | 'accepted' | 'rejected'
          notes?: string | null
          created_at?: string | null
          responded_at?: string | null
          response_notes?: string | null
        }
      }
      asset_list_items: {
        Row: {
          id: string
          list_id: string
          asset_id: string
          added_at: string | null
          added_by: string | null
          notes: string | null
          sort_order: number | null
          group_id: string | null
        }
        Insert: {
          id?: string
          list_id: string
          asset_id: string
          added_at?: string | null
          added_by?: string | null
          notes?: string | null
          sort_order?: number | null
          group_id?: string | null
        }
        Update: {
          id?: string
          list_id?: string
          asset_id?: string
          added_at?: string | null
          added_by?: string | null
          notes?: string | null
          sort_order?: number | null
          group_id?: string | null
        }
      }
      asset_list_groups: {
        Row: {
          id: string
          list_id: string
          name: string
          color: string | null
          sort_order: number | null
          is_collapsed: boolean | null
          created_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          list_id: string
          name: string
          color?: string | null
          sort_order?: number | null
          is_collapsed?: boolean | null
          created_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          list_id?: string
          name?: string
          color?: string | null
          sort_order?: number | null
          is_collapsed?: boolean | null
          created_at?: string | null
          created_by?: string | null
        }
      }
      asset_list_favorites: {
        Row: {
          id: string
          list_id: string
          user_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          list_id: string
          user_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          list_id?: string
          user_id?: string
          created_at?: string | null
        }
      }
      asset_list_collaborations: {
        Row: {
          id: string
          list_id: string
          user_id: string
          permission: 'read' | 'write' | 'admin'
          invited_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          list_id: string
          user_id: string
          permission?: 'read' | 'write' | 'admin'
          invited_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          list_id?: string
          user_id?: string
          permission?: 'read' | 'write' | 'admin'
          invited_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      portfolios: {
        Row: {
          id: string
          name: string
          benchmark: string | null
          description: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          benchmark?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          benchmark?: string | null
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
      }
      themes: {
        Row: {
          id: string
          name: string
          theme_type: 'sector' | 'geography' | 'strategy' | 'macro' | 'general' | null
          color: string | null
          description: string | null
          created_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          theme_type?: 'sector' | 'geography' | 'strategy' | 'macro' | 'general' | null
          color?: string | null
          description?: string | null
          created_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          theme_type?: 'sector' | 'geography' | 'strategy' | 'macro' | 'general' | null
          color?: string | null
          description?: string | null
          created_at?: string | null
          created_by?: string | null
        }
      }
      theme_assets: {
        Row: {
          id: string
          theme_id: string
          asset_id: string
          added_by: string | null
          added_at: string | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          theme_id: string
          asset_id: string
          added_by?: string | null
          added_at?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          theme_id?: string
          asset_id?: string
          added_by?: string | null
          added_at?: string | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      users: {
        Row: {
          id: string
          email: string | null
          first_name: string | null
          last_name: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          email?: string | null
          first_name?: string | null
          last_name?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          email?: string | null
          first_name?: string | null
          last_name?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      assets: {
        Row: {
          id: string
          symbol: string
          company_name: string
          current_price: number | null
          market_cap: string | null
          sector: string | null
          priority: 'high' | 'medium' | 'low' | null
          process_stage: 'research' | 'analysis' | 'monitoring' | 'review' | 'archived' | null
          thesis: string | null
          bull_case: string | null
          bear_case: string | null
          base_case: string | null
          where_different: string | null
          risks_to_thesis: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          symbol: string
          company_name: string
          current_price?: number | null
          market_cap?: string | null
          sector?: string | null
          priority?: 'high' | 'medium' | 'low' | null
          process_stage?: 'research' | 'analysis' | 'monitoring' | 'review' | 'archived' | null
          thesis?: string | null
          bull_case?: string | null
          bear_case?: string | null
          base_case?: string | null
          where_different?: string | null
          risks_to_thesis?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          symbol?: string
          company_name?: string
          current_price?: number | null
          market_cap?: string | null
          sector?: string | null
          priority?: 'high' | 'medium' | 'low' | null
          process_stage?: 'research' | 'analysis' | 'monitoring' | 'review' | 'archived' | null
          thesis?: string | null
          bull_case?: string | null
          bear_case?: string | null
          base_case?: string | null
          where_different?: string | null
          risks_to_thesis?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
      }
      price_targets: {
        Row: {
          id: string
          asset_id: string
          type: 'bull' | 'base' | 'bear'
          price: number
          timeframe: string | null
          reasoning: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          asset_id: string
          type: 'bull' | 'base' | 'bear'
          price: number
          timeframe?: string | null
          reasoning?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          asset_id?: string
          type?: 'bull' | 'base' | 'bear'
          price?: number
          timeframe?: string | null
          reasoning?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
        }
      }
      user_actions: {
        Row: {
          id: string
          user_id: string
          asset_id: string | null
          action_type: 'thesis_edit' | 'bull_case_edit' | 'bear_case_edit' | 'base_case_edit' | 'price_target_add' | 'price_target_edit' | 'price_target_delete' | 'priority_change' | 'status_change' | 'note_add' | 'note_edit' | 'note_delete'
          field_name: string | null
          old_value: string | null
          new_value: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          asset_id?: string | null
          action_type: 'thesis_edit' | 'bull_case_edit' | 'bear_case_edit' | 'base_case_edit' | 'price_target_add' | 'price_target_edit' | 'price_target_delete' | 'priority_change' | 'status_change' | 'note_add' | 'note_edit' | 'note_delete'
          field_name?: string | null
          old_value?: string | null
          new_value?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          asset_id?: string | null
          action_type?: 'thesis_edit' | 'bull_case_edit' | 'bear_case_edit' | 'base_case_edit' | 'price_target_add' | 'price_target_edit' | 'price_target_delete' | 'priority_change' | 'status_change' | 'note_add' | 'note_edit' | 'note_delete'
          field_name?: string | null
          old_value?: string | null
          new_value?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
      }
      coverage: {
        Row: {
          id: string
          asset_id: string
          user_id: string
          analyst_name: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          asset_id: string
          user_id: string
          analyst_name?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          asset_id?: string
          user_id?: string
          analyst_name?: string
          created_at?: string | null
          updated_at?: string | null
        }
      }
      messages: {
        Row: {
          id: string
          content: string
          user_id: string
          context_type: 'asset' | 'portfolio' | 'theme' | 'note' | 'field'
          context_id: string
          field_name: string | null
          cited_content: string | null
          reply_to: string | null
          is_pinned: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          content: string
          user_id: string
          context_type: 'asset' | 'portfolio' | 'theme' | 'note' | 'field'
          context_id: string
          field_name?: string | null
          cited_content?: string | null
          reply_to?: string | null
          is_pinned?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          content?: string
          user_id?: string
          context_type?: 'asset' | 'portfolio' | 'theme' | 'note' | 'field'
          context_id?: string
          field_name?: string | null
          cited_content?: string | null
          reply_to?: string | null
          is_pinned?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      conversations: {
        Row: {
          id: string
          name: string | null
          description: string
          is_group: boolean
          created_by: string | null
          created_at: string
          updated_at: string
          last_message_at: string
        }
        Insert: {
          id?: string
          name?: string | null
          description?: string
          is_group?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          last_message_at?: string
        }
        Update: {
          id?: string
          name?: string | null
          description?: string
          is_group?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          last_message_at?: string
        }
      }
      conversation_participants: {
        Row: {
          id: string
          conversation_id: string
          user_id: string
          joined_at: string
          last_read_at: string
          is_admin: boolean
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id: string
          joined_at?: string
          last_read_at?: string
          is_admin?: boolean
        }
        Update: {
          id?: string
          conversation_id?: string
          user_id?: string
          joined_at?: string
          last_read_at?: string
          is_admin?: boolean
        }
      }
      conversation_messages: {
        Row: {
          id: string
          conversation_id: string
          user_id: string
          content: string
          reply_to: string | null
          is_edited: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          user_id: string
          content: string
          reply_to?: string | null
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          user_id?: string
          content?: string
          reply_to?: string | null
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      note_collaborations: {
        Row: {
          id: string
          note_id: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general'
          user_id: string
          permission: 'read' | 'write' | 'admin'
          invited_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          note_id: string
          note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general'
          user_id: string
          permission?: 'read' | 'write' | 'admin'
          invited_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          note_id?: string
          note_type?: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general'
          user_id?: string
          permission?: 'read' | 'write' | 'admin'
          invited_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change'
          title: string
          message: string
          context_type: 'asset' | 'note' | 'portfolio' | 'theme'
          context_id: string
          context_data: any
          is_read: boolean
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change'
          title: string
          message: string
          context_type: 'asset' | 'note' | 'portfolio' | 'theme'
          context_id: string
          context_data?: any
          is_read?: boolean
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change'
          title?: string
          message?: string
          context_type?: 'asset' | 'note' | 'portfolio' | 'theme'
          context_id?: string
          context_data?: any
          is_read?: boolean
          created_at?: string
          read_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      priority_level: 'high' | 'medium' | 'low'
      process_stage: 'research' | 'analysis' | 'monitoring' | 'review' | 'archived'
      price_target_type: 'bull' | 'base' | 'bear'
      action_type: 'thesis_edit' | 'bull_case_edit' | 'bear_case_edit' | 'base_case_edit' | 'price_target_add' | 'price_target_edit' | 'price_target_delete' | 'priority_change' | 'status_change' | 'note_add' | 'note_edit' | 'note_delete' | 'notebook_create' | 'notebook_edit' | 'notebook_delete' | 'theme_create' | 'theme_edit' | 'theme_delete' | 'portfolio_create' | 'portfolio_edit' | 'portfolio_delete'
      note_type: 'meeting' | 'call' | 'research' | 'idea' | 'analysis' | 'general'
      theme_type: 'sector' | 'geography' | 'strategy' | 'macro' | 'general'
      collaboration_permission: 'read' | 'write' | 'admin'
      notebook_type: 'asset' | 'theme' | 'portfolio' | 'custom'
      notification_type: 'asset_field_change' | 'asset_priority_change' | 'asset_stage_change' | 'note_shared' | 'note_created' | 'price_target_change' | 'list_suggestion_received' | 'list_suggestion_accepted' | 'list_suggestion_rejected'
      list_type: 'mutual' | 'collaborative'
      suggestion_type: 'add' | 'remove'
      suggestion_status: 'pending' | 'accepted' | 'rejected'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}