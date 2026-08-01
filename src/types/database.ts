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
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      accepted_trade_comments: {
        Row: {
          accepted_trade_id: string
          comment_type: string
          content: string
          created_at: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          accepted_trade_id: string
          comment_type?: string
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          accepted_trade_id?: string
          comment_type?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accepted_trade_comments_accepted_trade_id_fkey"
            columns: ["accepted_trade_id"]
            isOneToOne: false
            referencedRelation: "accepted_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      accepted_trades: {
        Row: {
          acceptance_note: string | null
          accepted_by: string
          action: string
          asset_id: string
          batch_id: string | null
          corrects_accepted_trade_id: string | null
          created_at: string
          decision_request_id: string | null
          delta_shares: number | null
          delta_weight: number | null
          executed_by: string | null
          execution_completed_at: string | null
          execution_expected_by: string | null
          execution_note: string | null
          execution_started_at: string | null
          execution_status: string
          id: string
          is_active: boolean
          lab_variant_id: string | null
          last_activity_at: string
          notional_value: number | null
          portfolio_id: string
          price_at_acceptance: number | null
          proposal_id: string | null
          reconciled_at: string | null
          reconciliation_detail: Json | null
          reconciliation_status: string
          revert_reason: string | null
          reverted_at: string | null
          reverted_by: string | null
          sizing_input: string | null
          sizing_spec: Json | null
          sort_order: number | null
          source: string
          staleness_flagged_at: string | null
          target_shares: number | null
          target_weight: number | null
          trade_queue_item_id: string | null
          updated_at: string
        }
        Insert: {
          acceptance_note?: string | null
          accepted_by: string
          action: string
          asset_id: string
          batch_id?: string | null
          corrects_accepted_trade_id?: string | null
          created_at?: string
          decision_request_id?: string | null
          delta_shares?: number | null
          delta_weight?: number | null
          executed_by?: string | null
          execution_completed_at?: string | null
          execution_expected_by?: string | null
          execution_note?: string | null
          execution_started_at?: string | null
          execution_status?: string
          id?: string
          is_active?: boolean
          lab_variant_id?: string | null
          last_activity_at?: string
          notional_value?: number | null
          portfolio_id: string
          price_at_acceptance?: number | null
          proposal_id?: string | null
          reconciled_at?: string | null
          reconciliation_detail?: Json | null
          reconciliation_status?: string
          revert_reason?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          sizing_input?: string | null
          sizing_spec?: Json | null
          sort_order?: number | null
          source: string
          staleness_flagged_at?: string | null
          target_shares?: number | null
          target_weight?: number | null
          trade_queue_item_id?: string | null
          updated_at?: string
        }
        Update: {
          acceptance_note?: string | null
          accepted_by?: string
          action?: string
          asset_id?: string
          batch_id?: string | null
          corrects_accepted_trade_id?: string | null
          created_at?: string
          decision_request_id?: string | null
          delta_shares?: number | null
          delta_weight?: number | null
          executed_by?: string | null
          execution_completed_at?: string | null
          execution_expected_by?: string | null
          execution_note?: string | null
          execution_started_at?: string | null
          execution_status?: string
          id?: string
          is_active?: boolean
          lab_variant_id?: string | null
          last_activity_at?: string
          notional_value?: number | null
          portfolio_id?: string
          price_at_acceptance?: number | null
          proposal_id?: string | null
          reconciled_at?: string | null
          reconciliation_detail?: Json | null
          reconciliation_status?: string
          revert_reason?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          sizing_input?: string | null
          sizing_spec?: Json | null
          sort_order?: number | null
          source?: string
          staleness_flagged_at?: string | null
          target_shares?: number | null
          target_weight?: number | null
          trade_queue_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accepted_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "trade_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_corrects_fk"
            columns: ["corrects_accepted_trade_id"]
            isOneToOne: false
            referencedRelation: "accepted_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_decision_request_id_fkey"
            columns: ["decision_request_id"]
            isOneToOne: false
            referencedRelation: "decision_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_lab_variant_id_fkey"
            columns: ["lab_variant_id"]
            isOneToOne: false
            referencedRelation: "lab_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accepted_trades_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      access_requests: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          reason: string | null
          request_type: string
          requested_permissions: Json | null
          requested_title: string | null
          requester_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          target_portfolio_id: string | null
          target_role_id: string | null
          target_team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          request_type: string
          requested_permissions?: Json | null
          requested_title?: string | null
          requester_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_portfolio_id?: string | null
          target_role_id?: string | null
          target_team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          request_type?: string
          requested_permissions?: Json | null
          requested_title?: string | null
          requester_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_portfolio_id?: string | null
          target_role_id?: string | null
          target_team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_target_portfolio_id_fkey"
            columns: ["target_portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_target_role_id_fkey"
            columns: ["target_role_id"]
            isOneToOne: false
            referencedRelation: "user_role_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          action_category: string
          action_type: string
          actor_email: string | null
          actor_id: string
          actor_name: string | null
          actor_type: string
          changed_fields: string[] | null
          entity_display_name: string | null
          entity_id: string
          entity_type: string
          from_state: Json | null
          id: string
          lab_id: string | null
          metadata: Json
          occurred_at: string
          plan_id: string | null
          portfolio_id: string | null
          request_id: string | null
          to_state: Json | null
          view_id: string | null
        }
        Insert: {
          action_category?: string
          action_type: string
          actor_email?: string | null
          actor_id: string
          actor_name?: string | null
          actor_type?: string
          changed_fields?: string[] | null
          entity_display_name?: string | null
          entity_id: string
          entity_type: string
          from_state?: Json | null
          id?: string
          lab_id?: string | null
          metadata?: Json
          occurred_at?: string
          plan_id?: string | null
          portfolio_id?: string | null
          request_id?: string | null
          to_state?: Json | null
          view_id?: string | null
        }
        Update: {
          action_category?: string
          action_type?: string
          actor_email?: string | null
          actor_id?: string
          actor_name?: string | null
          actor_type?: string
          changed_fields?: string[] | null
          entity_display_name?: string | null
          entity_id?: string
          entity_type?: string
          from_state?: Json | null
          id?: string
          lab_id?: string | null
          metadata?: Json
          occurred_at?: string
          plan_id?: string | null
          portfolio_id?: string | null
          request_id?: string | null
          to_state?: Json | null
          view_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_asset_insights: {
        Row: {
          asset_id: string
          confidence: number | null
          created_at: string | null
          expires_at: string
          explanation: string | null
          id: string
          insight_type: string
          label: string
          metadata: Json | null
          severity: string | null
        }
        Insert: {
          asset_id: string
          confidence?: number | null
          created_at?: string | null
          expires_at: string
          explanation?: string | null
          id?: string
          insight_type: string
          label: string
          metadata?: Json | null
          severity?: string | null
        }
        Update: {
          asset_id?: string
          confidence?: number | null
          created_at?: string | null
          expires_at?: string
          explanation?: string | null
          id?: string
          insight_type?: string
          label?: string
          metadata?: Json | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_asset_insights_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_column_cache: {
        Row: {
          asset_id: string
          column_id: string
          content: string
          generated_at: string | null
          id: string
          input_hash: string | null
        }
        Insert: {
          asset_id: string
          column_id: string
          content: string
          generated_at?: string | null
          id?: string
          input_hash?: string | null
        }
        Update: {
          asset_id?: string
          column_id?: string
          content?: string
          generated_at?: string | null
          id?: string
          input_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_column_cache_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_column_cache_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "ai_column_library"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_column_library: {
        Row: {
          context_config: Json | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          organization_id: string | null
          prompt: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          context_config?: Json | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          organization_id?: string | null
          prompt: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          context_config?: Json | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          organization_id?: string | null
          prompt?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_column_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          tag_id: string
          tag_type: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          tag_id: string
          tag_type: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          tag_id?: string
          tag_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          context_id: string | null
          context_type: string | null
          created_at: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          last_message_at: string | null
          messages: Json | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          last_message_at?: string | null
          messages?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          last_message_at?: string | null
          messages?: Json | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          context_id: string | null
          context_type: string | null
          created_at: string | null
          estimated_cost: number | null
          id: string
          input_tokens: number | null
          mode: string
          model: string
          organization_id: string | null
          output_tokens: number | null
          provider: string
          purpose: string | null
          response_time_ms: number | null
          team_id: string | null
          user_id: string
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          estimated_cost?: number | null
          id?: string
          input_tokens?: number | null
          mode: string
          model: string
          organization_id?: string | null
          output_tokens?: number | null
          provider: string
          purpose?: string | null
          response_time_ms?: number | null
          team_id?: string | null
          user_id: string
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          estimated_cost?: number | null
          id?: string
          input_tokens?: number | null
          mode?: string
          model?: string
          organization_id?: string | null
          output_tokens?: number | null
          provider?: string
          purpose?: string | null
          response_time_ms?: number | null
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_attachments: {
        Row: {
          asset_class_id: string | null
          attachment_type: string | null
          created_at: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          period_id: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          asset_class_id?: string | null
          attachment_type?: string | null
          created_at?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          period_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          asset_class_id?: string | null
          attachment_type?: string | null
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          period_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_attachments_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_attachments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_cell_notes: {
        Row: {
          asset_class_id: string
          created_at: string | null
          id: string
          period_id: string
          thesis_notes: string | null
          updated_at: string | null
          updated_by: string | null
          view_type: string
        }
        Insert: {
          asset_class_id: string
          created_at?: string | null
          id?: string
          period_id: string
          thesis_notes?: string | null
          updated_at?: string | null
          updated_by?: string | null
          view_type: string
        }
        Update: {
          asset_class_id?: string
          created_at?: string | null
          id?: string
          period_id?: string
          thesis_notes?: string | null
          updated_at?: string | null
          updated_by?: string | null
          view_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocation_cell_notes_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_cell_notes_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_comments: {
        Row: {
          asset_class_id: string | null
          content: string
          created_at: string | null
          id: string
          is_pinned: boolean | null
          period_id: string
          reply_to: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_class_id?: string | null
          content: string
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          period_id: string
          reply_to?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_class_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          is_pinned?: boolean | null
          period_id?: string
          reply_to?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocation_comments_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_comments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_comments_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "allocation_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_history: {
        Row: {
          asset_class_id: string
          change_reason: string | null
          changed_at: string | null
          changed_by: string | null
          id: string
          new_view: Database["public"]["Enums"]["allocation_view"]
          period_id: string
          previous_view: Database["public"]["Enums"]["allocation_view"] | null
        }
        Insert: {
          asset_class_id: string
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_view: Database["public"]["Enums"]["allocation_view"]
          period_id: string
          previous_view?: Database["public"]["Enums"]["allocation_view"] | null
        }
        Update: {
          asset_class_id?: string
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_view?: Database["public"]["Enums"]["allocation_view"]
          period_id?: string
          previous_view?: Database["public"]["Enums"]["allocation_view"] | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_history_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_history_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_periods: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          id: string
          name: string
          organization_id: string
          start_date: string
          status: Database["public"]["Enums"]["allocation_view_status"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          name: string
          organization_id: string
          start_date: string
          status?: Database["public"]["Enums"]["allocation_view_status"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          name?: string
          organization_id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["allocation_view_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_team_members: {
        Row: {
          added_by: string | null
          asset_class_assignments: string[] | null
          created_at: string | null
          id: string
          is_active: boolean | null
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          added_by?: string | null
          asset_class_assignments?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          added_by?: string | null
          asset_class_assignments?: string[] | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocation_team_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_votes: {
        Row: {
          asset_class_id: string
          comment: string | null
          created_at: string | null
          id: string
          period_id: string
          proposed_view: Database["public"]["Enums"]["allocation_view"]
          updated_at: string | null
          user_id: string
          vote: Database["public"]["Enums"]["allocation_vote_type"]
        }
        Insert: {
          asset_class_id: string
          comment?: string | null
          created_at?: string | null
          id?: string
          period_id: string
          proposed_view: Database["public"]["Enums"]["allocation_view"]
          updated_at?: string | null
          user_id: string
          vote: Database["public"]["Enums"]["allocation_vote_type"]
        }
        Update: {
          asset_class_id?: string
          comment?: string | null
          created_at?: string | null
          id?: string
          period_id?: string
          proposed_view?: Database["public"]["Enums"]["allocation_view"]
          updated_at?: string | null
          user_id?: string
          vote?: Database["public"]["Enums"]["allocation_vote_type"]
        }
        Relationships: [
          {
            foreignKeyName: "allocation_votes_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_votes_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_estimate_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          estimate_id: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          estimate_id: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          estimate_id?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_estimate_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_estimate_history_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "analyst_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_estimates: {
        Row: {
          asset_id: string
          created_at: string | null
          currency: string | null
          fiscal_quarter: number | null
          fiscal_year: number
          id: string
          is_official: boolean | null
          metric_key: string
          notes: string | null
          period_type: string
          source: string | null
          source_file_id: string | null
          updated_at: string | null
          user_id: string
          value: number
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          currency?: string | null
          fiscal_quarter?: number | null
          fiscal_year: number
          id?: string
          is_official?: boolean | null
          metric_key: string
          notes?: string | null
          period_type: string
          source?: string | null
          source_file_id?: string | null
          updated_at?: string | null
          user_id: string
          value: number
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          currency?: string | null
          fiscal_quarter?: number | null
          fiscal_year?: number
          id?: string
          is_official?: boolean | null
          metric_key?: string
          notes?: string | null
          period_type?: string
          source?: string | null
          source_file_id?: string | null
          updated_at?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "analyst_estimates_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_estimates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_performance_snapshots: {
        Row: {
          asset_id: string | null
          avg_accuracy: number | null
          avg_days_to_hit: number | null
          bullish_bias: number | null
          created_at: string | null
          hit_rate: number | null
          hit_targets: number | null
          id: string
          missed_targets: number | null
          overall_score: number | null
          pending_targets: number | null
          period_end: string
          period_start: string
          period_type: string
          scenario_breakdown: Json | null
          total_targets: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          avg_accuracy?: number | null
          avg_days_to_hit?: number | null
          bullish_bias?: number | null
          created_at?: string | null
          hit_rate?: number | null
          hit_targets?: number | null
          id?: string
          missed_targets?: number | null
          overall_score?: number | null
          pending_targets?: number | null
          period_end: string
          period_start: string
          period_type: string
          scenario_breakdown?: Json | null
          total_targets?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string | null
          avg_accuracy?: number | null
          avg_days_to_hit?: number | null
          bullish_bias?: number | null
          created_at?: string | null
          hit_rate?: number | null
          hit_targets?: number | null
          id?: string
          missed_targets?: number | null
          overall_score?: number | null
          pending_targets?: number | null
          period_end?: string
          period_start?: string
          period_type?: string
          scenario_breakdown?: Json | null
          total_targets?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyst_performance_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_performance_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_price_target_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          price_target_id: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          price_target_id?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          price_target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_price_target_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_price_target_history_price_target_id_fkey"
            columns: ["price_target_id"]
            isOneToOne: false
            referencedRelation: "analyst_price_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_price_targets: {
        Row: {
          asset_id: string
          created_at: string | null
          draft_is_rolling: boolean | null
          draft_price: number | null
          draft_probability: number | null
          draft_reasoning: string | null
          draft_target_date: string | null
          draft_timeframe: string | null
          draft_timeframe_type: string | null
          draft_updated_at: string | null
          id: string
          is_official: boolean | null
          is_rolling: boolean | null
          organization_id: string | null
          price: number
          probability: number | null
          reasoning: string | null
          scenario_id: string
          target_date: string | null
          timeframe: string | null
          timeframe_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          draft_is_rolling?: boolean | null
          draft_price?: number | null
          draft_probability?: number | null
          draft_reasoning?: string | null
          draft_target_date?: string | null
          draft_timeframe?: string | null
          draft_timeframe_type?: string | null
          draft_updated_at?: string | null
          id?: string
          is_official?: boolean | null
          is_rolling?: boolean | null
          organization_id?: string | null
          price: number
          probability?: number | null
          reasoning?: string | null
          scenario_id: string
          target_date?: string | null
          timeframe?: string | null
          timeframe_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          draft_is_rolling?: boolean | null
          draft_price?: number | null
          draft_probability?: number | null
          draft_reasoning?: string | null
          draft_target_date?: string | null
          draft_timeframe?: string | null
          draft_timeframe_type?: string | null
          draft_updated_at?: string | null
          id?: string
          is_official?: boolean | null
          is_rolling?: boolean | null
          organization_id?: string | null
          price?: number
          probability?: number | null
          reasoning?: string | null
          scenario_id?: string
          target_date?: string | null
          timeframe?: string | null
          timeframe_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyst_price_targets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_price_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_price_targets_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_price_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_rating_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          rating_id: string
          source: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          rating_id: string
          source?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          rating_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyst_rating_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_rating_history_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "analyst_ratings"
            referencedColumns: ["id"]
          },
        ]
      }
      analyst_ratings: {
        Row: {
          asset_id: string
          conviction: string | null
          created_at: string | null
          id: string
          is_official: boolean | null
          notes: string | null
          organization_id: string | null
          rating_scale_id: string
          rating_value: string
          source: string | null
          source_file_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          conviction?: string | null
          created_at?: string | null
          id?: string
          is_official?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating_scale_id: string
          rating_value: string
          source?: string | null
          source_file_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          conviction?: string | null
          created_at?: string | null
          id?: string
          is_official?: boolean | null
          notes?: string | null
          organization_id?: string | null
          rating_scale_id?: string
          rating_value?: string
          source?: string | null
          source_file_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyst_ratings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_ratings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_ratings_rating_scale_id_fkey"
            columns: ["rating_scale_id"]
            isOneToOne: false
            referencedRelation: "rating_scales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyst_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_checklist_attachments: {
        Row: {
          asset_id: string
          created_at: string | null
          description: string | null
          evidence_type: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          item_id: string
          stage_id: string
          updated_at: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          workflow_id: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          description?: string | null
          evidence_type?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          item_id: string
          stage_id: string
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          workflow_id?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          description?: string | null
          evidence_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          item_id?: string
          stage_id?: string
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_checklist_attachments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_attachments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_attachments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_checklist_items: {
        Row: {
          asset_id: string
          assignee_id: string | null
          comment: string | null
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string
          is_custom: boolean | null
          item_id: string
          item_text: string | null
          item_type: string
          notes: string | null
          sort_order: number | null
          source_thinking_item_id: string | null
          source_type: string
          source_work_request_id: string | null
          stage_id: string
          status: string
          takeaway: string | null
          takeaway_revision_count: number
          takeaway_update_source: string | null
          takeaway_updated_at: string | null
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          asset_id: string
          assignee_id?: string | null
          comment?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          is_custom?: boolean | null
          item_id: string
          item_text?: string | null
          item_type?: string
          notes?: string | null
          sort_order?: number | null
          source_thinking_item_id?: string | null
          source_type?: string
          source_work_request_id?: string | null
          stage_id: string
          status?: string
          takeaway?: string | null
          takeaway_revision_count?: number
          takeaway_update_source?: string | null
          takeaway_updated_at?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          asset_id?: string
          assignee_id?: string | null
          comment?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          is_custom?: boolean | null
          item_id?: string
          item_text?: string | null
          item_type?: string
          notes?: string | null
          sort_order?: number | null
          source_thinking_item_id?: string | null
          source_type?: string
          source_work_request_id?: string | null
          stage_id?: string
          status?: string
          takeaway?: string | null
          takeaway_revision_count?: number
          takeaway_update_source?: string | null
          takeaway_updated_at?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_checklist_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_source_thinking_item_id_fkey"
            columns: ["source_thinking_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_source_work_request_id_fkey"
            columns: ["source_work_request_id"]
            isOneToOne: false
            referencedRelation: "checklist_work_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_classes: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_classes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_contribution_history: {
        Row: {
          changed_at: string
          changed_by: string
          contribution_id: string
          id: string
          new_content: string
          new_supporting_detail: string | null
          old_content: string | null
          old_supporting_detail: string | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          contribution_id: string
          id?: string
          new_content: string
          new_supporting_detail?: string | null
          old_content?: string | null
          old_supporting_detail?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          contribution_id?: string
          id?: string
          new_content?: string
          new_supporting_detail?: string | null
          old_content?: string | null
          old_supporting_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_contribution_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contribution_history_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "asset_contributions"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_contributions: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          asset_id: string
          attachments: Json | null
          content: string
          created_at: string
          created_by: string
          draft_content: string | null
          draft_updated_at: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          organization_id: string | null
          pinned_at: string | null
          pinned_by: string | null
          section: string
          sort_order: number
          supporting_detail: string | null
          team_id: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          asset_id: string
          attachments?: Json | null
          content: string
          created_at?: string
          created_by: string
          draft_content?: string | null
          draft_updated_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          section: string
          sort_order?: number
          supporting_detail?: string | null
          team_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          asset_id?: string
          attachments?: Json | null
          content?: string
          created_at?: string
          created_by?: string
          draft_content?: string | null
          draft_updated_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          section?: string
          sort_order?: number
          supporting_detail?: string | null
          team_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_contributions_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_contributions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_earnings_dates: {
        Row: {
          asset_id: string
          created_at: string | null
          created_by: string | null
          earnings_date: string
          earnings_quarter: string | null
          earnings_year: number | null
          id: string
          is_estimated: boolean | null
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          created_by?: string | null
          earnings_date: string
          earnings_quarter?: string | null
          earnings_year?: number | null
          id?: string
          is_estimated?: boolean | null
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          created_by?: string | null
          earnings_date?: string
          earnings_quarter?: string | null
          earnings_year?: number | null
          id?: string
          is_estimated?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_earnings_dates_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_earnings_dates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_field_history: {
        Row: {
          asset_id: string
          changed_at: string | null
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          asset_id: string
          changed_at?: string | null
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          asset_id?: string
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_field_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_field_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_followup_suppressions: {
        Row: {
          asset_id: string
          created_at: string | null
          followup_type: string | null
          id: string
          suppressed_until: string
          updated_at: string | null
          user_id: string
          view_user_id: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          followup_type?: string | null
          id?: string
          suppressed_until: string
          updated_at?: string | null
          user_id: string
          view_user_id?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          followup_type?: string | null
          id?: string
          suppressed_until?: string
          updated_at?: string | null
          user_id?: string
          view_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_followup_suppressions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_activity: {
        Row: {
          activity_type: string
          actor_id: string | null
          created_at: string
          id: string
          list_id: string
          metadata: Json | null
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          created_at?: string
          id?: string
          list_id: string
          metadata?: Json | null
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          list_id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_activity_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          list_id: string | null
          permission: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          list_id?: string | null
          permission?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          list_id?: string | null
          permission?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_collaborations_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_favorites: {
        Row: {
          created_at: string | null
          id: string
          list_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          list_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_favorites_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_collapsed: boolean | null
          list_id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_collapsed?: boolean | null
          list_id: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_collapsed?: boolean | null
          list_id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_groups_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_items: {
        Row: {
          added_at: string | null
          added_by: string | null
          asset_id: string | null
          assignee_id: string | null
          due_date: string | null
          group_id: string | null
          id: string
          is_flagged: boolean
          list_category: string | null
          list_id: string | null
          notes: string | null
          sort_order: number | null
          status_id: string | null
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          asset_id?: string | null
          assignee_id?: string | null
          due_date?: string | null
          group_id?: string | null
          id?: string
          is_flagged?: boolean
          list_category?: string | null
          list_id?: string | null
          notes?: string | null
          sort_order?: number | null
          status_id?: string | null
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          asset_id?: string | null
          assignee_id?: string | null
          due_date?: string | null
          group_id?: string | null
          id?: string
          is_flagged?: boolean
          list_category?: string | null
          list_id?: string | null
          notes?: string | null
          sort_order?: number | null
          status_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "asset_list_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_items_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "list_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_suggestions: {
        Row: {
          asset_id: string
          created_at: string | null
          id: string
          list_id: string
          notes: string | null
          responded_at: string | null
          response_notes: string | null
          status: string
          suggested_by: string
          suggestion_type: string
          target_user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          id?: string
          list_id: string
          notes?: string | null
          responded_at?: string | null
          response_notes?: string | null
          status?: string
          suggested_by: string
          suggestion_type: string
          target_user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          id?: string
          list_id?: string
          notes?: string | null
          responded_at?: string | null
          response_notes?: string | null
          status?: string
          suggested_by?: string
          suggestion_type?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_suggestions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_list_suggestions_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_list_user_state: {
        Row: {
          last_opened_at: string
          list_id: string
          user_id: string
        }
        Insert: {
          last_opened_at?: string
          list_id: string
          user_id: string
        }
        Update: {
          last_opened_at?: string
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_list_user_state_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_lists: {
        Row: {
          brief: string | null
          color: string | null
          content_mode: string
          created_at: string | null
          created_by: string | null
          deadline: string | null
          description: string | null
          id: string
          is_default: boolean | null
          lifecycle: string
          list_type: string
          name: string
          organization_id: string | null
          portfolio_id: string | null
          screen_criteria: Json | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          brief?: string | null
          color?: string | null
          content_mode?: string
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          lifecycle?: string
          list_type?: string
          name: string
          organization_id?: string | null
          portfolio_id?: string | null
          screen_criteria?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          brief?: string | null
          color?: string | null
          content_mode?: string
          created_at?: string | null
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          lifecycle?: string
          list_type?: string
          name?: string
          organization_id?: string | null
          portfolio_id?: string | null
          screen_criteria?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_lists_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_lists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_models: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          description: string | null
          external_provider: string | null
          external_url: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          id: string
          is_deleted: boolean
          is_shared: boolean
          name: string
          source_type: string
          updated_at: string
          version: number
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by: string
          description?: string | null
          external_provider?: string | null
          external_url?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean
          name: string
          source_type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          external_provider?: string | null
          external_url?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean
          name?: string
          source_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_models_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_models_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_notes: {
        Row: {
          asset_id: string
          content: string
          content_preview: string | null
          created_at: string | null
          created_by: string | null
          external_provider: string | null
          external_url: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          id: string
          is_deleted: boolean
          is_shared: boolean | null
          metadata: Json | null
          note_type: Database["public"]["Enums"]["note_type"] | null
          organization_id: string | null
          source_type: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          asset_id: string
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          external_provider?: string | null
          external_url?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          asset_id?: string
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          external_provider?: string | null
          external_url?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_notes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_page_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          organization_id: string
          sections: Json
          team_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id: string
          sections?: Json
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          sections?: Json
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_page_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_page_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_page_templates_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_page_templates_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_revision_events: {
        Row: {
          after_value: string | null
          before_value: string | null
          category: Database["public"]["Enums"]["revision_event_category"]
          created_at: string
          field_key: string
          id: string
          revision_id: string
          significance_tier: number
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          category: Database["public"]["Enums"]["revision_event_category"]
          created_at?: string
          field_key: string
          id?: string
          revision_id: string
          significance_tier?: number
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          category?: Database["public"]["Enums"]["revision_event_category"]
          created_at?: string
          field_key?: string
          id?: string
          revision_id?: string
          significance_tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_revision_events_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "asset_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_revisions: {
        Row: {
          actor_user_id: string
          asset_id: string
          created_at: string
          id: string
          last_activity_at: string
          revision_note: string | null
          view_scope_type: Database["public"]["Enums"]["revision_view_scope"]
          view_scope_user_id: string | null
        }
        Insert: {
          actor_user_id: string
          asset_id: string
          created_at?: string
          id?: string
          last_activity_at?: string
          revision_note?: string | null
          view_scope_type?: Database["public"]["Enums"]["revision_view_scope"]
          view_scope_user_id?: string | null
        }
        Update: {
          actor_user_id?: string
          asset_id?: string
          created_at?: string
          id?: string
          last_activity_at?: string
          revision_note?: string | null
          view_scope_type?: Database["public"]["Enums"]["revision_view_scope"]
          view_scope_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_revisions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_revisions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_revisions_view_scope_user_id_fkey"
            columns: ["view_scope_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_rounding_configs: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          lot_size: number
          min_lot_behavior: Database["public"]["Enums"]["min_lot_behavior"]
          portfolio_id: string
          round_direction: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lot_size?: number
          min_lot_behavior?: Database["public"]["Enums"]["min_lot_behavior"]
          portfolio_id: string
          round_direction?: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lot_size?: number
          min_lot_behavior?: Database["public"]["Enums"]["min_lot_behavior"]
          portfolio_id?: string
          round_direction?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_rounding_configs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_rounding_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_rounding_configs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_stage_deadlines: {
        Row: {
          asset_id: string
          created_at: string | null
          deadline_date: string
          id: string
          notes: string | null
          set_by: string | null
          stage_id: string
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          deadline_date: string
          id?: string
          notes?: string | null
          set_by?: string | null
          stage_id: string
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          deadline_date?: string
          id?: string
          notes?: string | null
          set_by?: string | null
          stage_id?: string
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_stage_deadlines_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_stage_deadlines_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_stage_deadlines_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_stage_deadlines_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_tag_assignments: {
        Row: {
          asset_id: string
          assigned_at: string | null
          assigned_by: string | null
          id: string
          tag_id: string
        }
        Insert: {
          asset_id: string
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          tag_id: string
        }
        Update: {
          asset_id?: string
          assigned_at?: string | null
          assigned_by?: string | null
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_tag_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "asset_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_tags: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      asset_team_history: {
        Row: {
          asset_id: string
          change_type: string
          changed_at: string | null
          changed_by: string | null
          id: string
          new_focuses: string[] | null
          new_role: string | null
          old_focuses: string[] | null
          old_role: string | null
          team_member_id: string | null
          user_id: string | null
        }
        Insert: {
          asset_id: string
          change_type: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_focuses?: string[] | null
          new_role?: string | null
          old_focuses?: string[] | null
          old_role?: string | null
          team_member_id?: string | null
          user_id?: string | null
        }
        Update: {
          asset_id?: string
          change_type?: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          new_focuses?: string[] | null
          new_role?: string | null
          old_focuses?: string[] | null
          old_role?: string | null
          team_member_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_team_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_team_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_team_history_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "asset_team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_team_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_team_members: {
        Row: {
          added_by: string | null
          asset_id: string
          created_at: string | null
          focuses: string[] | null
          id: string
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          added_by?: string | null
          asset_id: string
          created_at?: string | null
          focuses?: string[] | null
          id?: string
          role: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          added_by?: string | null
          asset_id?: string
          created_at?: string | null
          focuses?: string[] | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_team_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_team_members_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_workflow_priorities: {
        Row: {
          asset_id: string
          created_at: string | null
          id: string
          priority: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          id?: string
          priority?: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          id?: string
          priority?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_workflow_priorities_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_priorities_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_priorities_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_workflow_progress: {
        Row: {
          asset_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          current_stage_key: string | null
          id: string
          is_completed: boolean | null
          is_started: boolean
          started_at: string | null
          started_by: string | null
          updated_at: string | null
          updated_by: string | null
          workflow_id: string
        }
        Insert: {
          asset_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          started_at?: string | null
          started_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          workflow_id: string
        }
        Update: {
          asset_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          started_at?: string | null
          started_by?: string | null
          updated_at?: string | null
          updated_by?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_workflow_progress_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_progress_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_progress_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_progress_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          company_name: string
          completeness: number | null
          country: string | null
          created_at: string | null
          created_by: string | null
          current_price: number | null
          exchange: string | null
          id: string
          industry: string | null
          market_cap: number | null
          priority: Database["public"]["Enums"]["priority_level"] | null
          process_stage: Database["public"]["Enums"]["process_stage"] | null
          quick_note: string | null
          quick_note_updated_at: string | null
          risks_to_thesis: string | null
          sector: string | null
          symbol: string
          thesis: string | null
          thesis_references: Json | null
          updated_at: string | null
          where_different: string | null
          workflow_id: string | null
        }
        Insert: {
          company_name: string
          completeness?: number | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          current_price?: number | null
          exchange?: string | null
          id?: string
          industry?: string | null
          market_cap?: number | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          process_stage?: Database["public"]["Enums"]["process_stage"] | null
          quick_note?: string | null
          quick_note_updated_at?: string | null
          risks_to_thesis?: string | null
          sector?: string | null
          symbol: string
          thesis?: string | null
          thesis_references?: Json | null
          updated_at?: string | null
          where_different?: string | null
          workflow_id?: string | null
        }
        Update: {
          company_name?: string
          completeness?: number | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          current_price?: number | null
          exchange?: string | null
          id?: string
          industry?: string | null
          market_cap?: number | null
          priority?: Database["public"]["Enums"]["priority_level"] | null
          process_stage?: Database["public"]["Enums"]["process_stage"] | null
          quick_note?: string | null
          quick_note_updated_at?: string | null
          risks_to_thesis?: string | null
          sector?: string | null
          symbol?: string
          thesis?: string | null
          thesis_references?: Json | null
          updated_at?: string | null
          where_different?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      attention_user_state: {
        Row: {
          attention_id: string
          created_at: string
          dismiss_note: string | null
          dismiss_reason: string | null
          dismissed_at: string | null
          id: string
          last_viewed_at: string | null
          personal_rank_override: number | null
          read_state: Database["public"]["Enums"]["attention_read_state"]
          snoozed_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attention_id: string
          created_at?: string
          dismiss_note?: string | null
          dismiss_reason?: string | null
          dismissed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          personal_rank_override?: number | null
          read_state?: Database["public"]["Enums"]["attention_read_state"]
          snoozed_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attention_id?: string
          created_at?: string
          dismiss_note?: string | null
          dismiss_reason?: string | null
          dismissed_at?: string | null
          id?: string
          last_viewed_at?: string | null
          personal_rank_override?: number | null
          read_state?: Database["public"]["Enums"]["attention_read_state"]
          snoozed_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action_category: string
          action_type: string
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          actor_type: string
          asset_id: string | null
          asset_symbol: string | null
          changed_fields: string[] | null
          checksum: string
          entity_display_name: string | null
          entity_id: string
          entity_type: string
          from_state: Json | null
          id: string
          metadata: Json
          occurred_at: string
          org_id: string | null
          parent_entity_id: string | null
          parent_entity_type: string | null
          portfolio_id: string | null
          recorded_at: string
          search_text: string | null
          team_id: string | null
          to_state: Json | null
        }
        Insert: {
          action_category: string
          action_type: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          actor_type?: string
          asset_id?: string | null
          asset_symbol?: string | null
          changed_fields?: string[] | null
          checksum: string
          entity_display_name?: string | null
          entity_id: string
          entity_type: string
          from_state?: Json | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string | null
          parent_entity_id?: string | null
          parent_entity_type?: string | null
          portfolio_id?: string | null
          recorded_at?: string
          search_text?: string | null
          team_id?: string | null
          to_state?: Json | null
        }
        Update: {
          action_category?: string
          action_type?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          actor_type?: string
          asset_id?: string | null
          asset_symbol?: string | null
          changed_fields?: string[] | null
          checksum?: string
          entity_display_name?: string | null
          entity_id?: string
          entity_type?: string
          from_state?: Json | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string | null
          parent_entity_id?: string | null
          parent_entity_type?: string | null
          portfolio_id?: string | null
          recorded_at?: string
          search_text?: string | null
          team_id?: string | null
          to_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      author_follows: {
        Row: {
          created_at: string | null
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string | null
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string | null
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          browser_info: Json | null
          console_errors: Json | null
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          organization_id: string
          page_url: string | null
          reported_by: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          browser_info?: Json | null
          console_errors?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          page_url?: string | null
          reported_by: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          browser_info?: Json | null
          console_errors?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          page_url?: string | null
          reported_by?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          access_token: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          provider: string
          provider_account_id: string | null
          provider_email: string | null
          refresh_token: string | null
          scopes: string[] | null
          sync_direction: string | null
          sync_enabled: boolean | null
          sync_error: string | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider: string
          provider_account_id?: string | null
          provider_email?: string | null
          refresh_token?: string | null
          scopes?: string[] | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          sync_error?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider?: string
          provider_account_id?: string | null
          provider_email?: string | null
          refresh_token?: string | null
          scopes?: string[] | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          sync_error?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      calendar_event_reminders: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          is_sent: boolean | null
          reminder_time: string
          reminder_type: string | null
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          is_sent?: boolean | null
          reminder_time: string
          reminder_type?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          is_sent?: boolean | null
          reminder_time?: string
          reminder_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_event_reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "org_calendar_events_v"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean | null
          assigned_to: string | null
          color: string | null
          context_id: string | null
          context_title: string | null
          context_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          event_type: Database["public"]["Enums"]["calendar_event_type"]
          id: string
          is_recurring: boolean | null
          location: string | null
          organization_id: string
          parent_event_id: string | null
          priority: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          start_date: string
          status: string | null
          title: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          all_day?: boolean | null
          assigned_to?: string | null
          color?: string | null
          context_id?: string | null
          context_title?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          is_recurring?: boolean | null
          location?: string | null
          organization_id: string
          parent_event_id?: string | null
          priority?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_date: string
          status?: string | null
          title: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          all_day?: boolean | null
          assigned_to?: string | null
          color?: string | null
          context_id?: string | null
          context_title?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          is_recurring?: boolean | null
          location?: string | null
          organization_id?: string
          parent_event_id?: string | null
          priority?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_date?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "org_calendar_events_v"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_logs: {
        Row: {
          completed_at: string | null
          connection_id: string
          error_message: string | null
          events_created: number | null
          events_deleted: number | null
          events_updated: number | null
          id: string
          started_at: string | null
          status: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          error_message?: string | null
          events_created?: number | null
          events_deleted?: number | null
          events_updated?: number | null
          id?: string
          started_at?: string | null
          status: string
          sync_type: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          error_message?: string | null
          events_created?: number | null
          events_deleted?: number | null
          events_updated?: number | null
          id?: string
          started_at?: string | null
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      captures: {
        Row: {
          capture_type: string
          created_at: string | null
          created_by: string
          display_title: string | null
          entity_display: string | null
          entity_id: string | null
          entity_type: string | null
          external_description: string | null
          external_favicon_url: string | null
          external_image_url: string | null
          external_metadata: Json | null
          external_title: string | null
          external_url: string | null
          id: string
          is_expanded: boolean | null
          organization_id: string
          preview_height: number | null
          preview_width: number | null
          screenshot_notes: string | null
          screenshot_source_url: string | null
          screenshot_storage_path: string | null
          screenshot_tags: string[] | null
          snapshot_at: string | null
          snapshot_data: Json | null
          source_id: string
          source_type: string
          updated_at: string | null
        }
        Insert: {
          capture_type: string
          created_at?: string | null
          created_by: string
          display_title?: string | null
          entity_display?: string | null
          entity_id?: string | null
          entity_type?: string | null
          external_description?: string | null
          external_favicon_url?: string | null
          external_image_url?: string | null
          external_metadata?: Json | null
          external_title?: string | null
          external_url?: string | null
          id?: string
          is_expanded?: boolean | null
          organization_id: string
          preview_height?: number | null
          preview_width?: number | null
          screenshot_notes?: string | null
          screenshot_source_url?: string | null
          screenshot_storage_path?: string | null
          screenshot_tags?: string[] | null
          snapshot_at?: string | null
          snapshot_data?: Json | null
          source_id: string
          source_type: string
          updated_at?: string | null
        }
        Update: {
          capture_type?: string
          created_at?: string | null
          created_by?: string
          display_title?: string | null
          entity_display?: string | null
          entity_id?: string | null
          entity_type?: string | null
          external_description?: string | null
          external_favicon_url?: string | null
          external_image_url?: string | null
          external_metadata?: Json | null
          external_title?: string | null
          external_url?: string | null
          id?: string
          is_expanded?: boolean | null
          organization_id?: string
          preview_height?: number | null
          preview_width?: number | null
          screenshot_notes?: string | null
          screenshot_source_url?: string | null
          screenshot_storage_path?: string | null
          screenshot_tags?: string[] | null
          snapshot_at?: string | null
          snapshot_data?: Json | null
          source_id?: string
          source_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "captures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      case_templates: {
        Row: {
          base_template: string | null
          bear_template: string | null
          bull_template: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_shared: boolean
          name: string
          organization_id: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          base_template?: string | null
          bear_template?: string | null
          bull_template?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_shared?: boolean
          name: string
          organization_id: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          base_template?: string | null
          bear_template?: string | null
          bull_template?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_shared?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "case_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_annotations: {
        Row: {
          annotation_type: string
          chart_id: string | null
          color: string | null
          created_at: string | null
          feed_item_id: string | null
          feed_item_type: string | null
          id: string
          is_dashed: boolean | null
          is_visible: boolean | null
          stroke_width: number | null
          symbol: string | null
          text_content: string | null
          timeframe: string | null
          updated_at: string | null
          user_id: string
          x1: number
          x2: number | null
          y1: number
          y2: number | null
        }
        Insert: {
          annotation_type: string
          chart_id?: string | null
          color?: string | null
          created_at?: string | null
          feed_item_id?: string | null
          feed_item_type?: string | null
          id?: string
          is_dashed?: boolean | null
          is_visible?: boolean | null
          stroke_width?: number | null
          symbol?: string | null
          text_content?: string | null
          timeframe?: string | null
          updated_at?: string | null
          user_id: string
          x1: number
          x2?: number | null
          y1: number
          y2?: number | null
        }
        Update: {
          annotation_type?: string
          chart_id?: string | null
          color?: string | null
          created_at?: string | null
          feed_item_id?: string | null
          feed_item_type?: string | null
          id?: string
          is_dashed?: boolean | null
          is_visible?: boolean | null
          stroke_width?: number | null
          symbol?: string | null
          text_content?: string | null
          timeframe?: string | null
          updated_at?: string | null
          user_id?: string
          x1?: number
          x2?: number | null
          y1?: number
          y2?: number | null
        }
        Relationships: []
      }
      checklist_comment_mentions: {
        Row: {
          checklist_item_id: string
          comment_text: string
          created_at: string | null
          id: string
          mention_position: number
          mentioned_by: string
          mentioned_user_id: string
        }
        Insert: {
          checklist_item_id: string
          comment_text: string
          created_at?: string | null
          id?: string
          mention_position: number
          mentioned_by: string
          mentioned_user_id: string
        }
        Update: {
          checklist_item_id?: string
          comment_text?: string
          created_at?: string | null
          id?: string
          mention_position?: number
          mentioned_by?: string
          mentioned_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_comment_mentions_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_comment_mentions_mentioned_by_fkey"
            columns: ["mentioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_comment_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_comment_references: {
        Row: {
          checklist_item_id: string
          created_at: string | null
          created_by: string
          id: string
          reference_id: string
          reference_text: string
          reference_type: string
        }
        Insert: {
          checklist_item_id: string
          created_at?: string | null
          created_by: string
          id?: string
          reference_id: string
          reference_text: string
          reference_type: string
        }
        Update: {
          checklist_item_id?: string
          created_at?: string | null
          created_by?: string
          id?: string
          reference_id?: string
          reference_text?: string
          reference_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_comment_references_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_comment_references_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_item_comments: {
        Row: {
          checklist_item_id: string
          comment_text: string
          created_at: string | null
          id: string
          is_edited: boolean | null
          signal_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          checklist_item_id: string
          comment_text: string
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          signal_type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          checklist_item_id?: string
          comment_text?: string
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          signal_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_comments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_task_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string
          assigned_user_id: string
          checklist_item_id: string
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by: string
          assigned_user_id: string
          checklist_item_id: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string
          assigned_user_id?: string
          checklist_item_id?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_task_assignments_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_task_assignments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_work_requests: {
        Row: {
          checklist_item_id: string
          completed_at: string | null
          context_notes: string | null
          create_tracked_task: boolean
          created_at: string | null
          due_date: string | null
          expected_output: string | null
          id: string
          linked_operational_item_id: string | null
          owner_id: string
          prompt: string
          prompt_id: string | null
          request_type: string
          requested_by: string
          resolved_at: string | null
          result_converted_to_signal_id: string | null
          result_note: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          checklist_item_id: string
          completed_at?: string | null
          context_notes?: string | null
          create_tracked_task?: boolean
          created_at?: string | null
          due_date?: string | null
          expected_output?: string | null
          id?: string
          linked_operational_item_id?: string | null
          owner_id: string
          prompt: string
          prompt_id?: string | null
          request_type: string
          requested_by: string
          resolved_at?: string | null
          result_converted_to_signal_id?: string | null
          result_note?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          checklist_item_id?: string
          completed_at?: string | null
          context_notes?: string | null
          create_tracked_task?: boolean
          created_at?: string | null
          due_date?: string | null
          expected_output?: string | null
          id?: string
          linked_operational_item_id?: string | null
          owner_id?: string
          prompt?: string
          prompt_id?: string | null
          request_type?: string
          requested_by?: string
          resolved_at?: string | null
          result_converted_to_signal_id?: string | null
          result_note?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_work_requests_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_work_requests_linked_operational_item_id_fkey"
            columns: ["linked_operational_item_id"]
            isOneToOne: false
            referencedRelation: "asset_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_work_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_work_requests_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "quick_thoughts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_work_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      connected_calendars: {
        Row: {
          calendar_color: string | null
          calendar_name: string
          connection_id: string
          created_at: string | null
          external_calendar_id: string
          id: string
          is_primary: boolean | null
          sync_enabled: boolean | null
        }
        Insert: {
          calendar_color?: string | null
          calendar_name: string
          connection_id: string
          created_at?: string | null
          external_calendar_id: string
          id?: string
          is_primary?: boolean | null
          sync_enabled?: boolean | null
        }
        Update: {
          calendar_color?: string | null
          calendar_name?: string
          connection_id?: string
          created_at?: string | null
          external_calendar_id?: string
          id?: string
          is_primary?: boolean | null
          sync_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "connected_calendars_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_reactions: {
        Row: {
          contribution_id: string
          created_at: string
          id: string
          reaction: string
          user_id: string
        }
        Insert: {
          contribution_id: string
          created_at?: string
          id?: string
          reaction: string
          user_id: string
        }
        Update: {
          contribution_id?: string
          created_at?: string
          id?: string
          reaction?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_reactions_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "asset_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_replies: {
        Row: {
          content: string
          contribution_id: string
          created_at: string
          created_by: string
          id: string
          is_edited: boolean
          parent_reply_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          contribution_id: string
          created_at?: string
          created_by: string
          id?: string
          is_edited?: boolean
          parent_reply_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          contribution_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_edited?: boolean
          parent_reply_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_replies_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "asset_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_replies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_replies_parent_reply_id_fkey"
            columns: ["parent_reply_id"]
            isOneToOne: false
            referencedRelation: "contribution_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_summaries: {
        Row: {
          asset_id: string
          contribution_count: number
          created_at: string | null
          generated_at: string
          generated_by: string | null
          id: string
          last_contribution_at: string | null
          section: string
          summary: string
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          contribution_count?: number
          created_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          last_contribution_at?: string | null
          section: string
          summary: string
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          contribution_count?: number
          created_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          last_contribution_at?: string | null
          section?: string
          summary?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contribution_summaries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_summaries_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contribution_visibility_targets: {
        Row: {
          contribution_id: string
          created_at: string | null
          id: string
          node_id: string
          organization_id: string | null
        }
        Insert: {
          contribution_id: string
          created_at?: string | null
          id?: string
          node_id: string
          organization_id?: string | null
        }
        Update: {
          contribution_id?: string
          created_at?: string | null
          id?: string
          node_id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contribution_visibility_targets_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "asset_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_visibility_targets_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_visibility_targets_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contribution_visibility_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string | null
          created_at: string | null
          id: string
          is_edited: boolean | null
          is_pinned: boolean | null
          reply_to: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          is_pinned?: boolean | null
          reply_to?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          is_pinned?: boolean | null
          reply_to?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string | null
          id: string
          is_admin: boolean | null
          joined_at: string | null
          last_read_at: string | null
          user_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
          last_read_at?: string | null
          user_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          id?: string
          is_admin?: boolean | null
          joined_at?: string | null
          last_read_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_group: boolean | null
          last_message_at: string | null
          name: string | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_group?: boolean | null
          last_message_at?: string | null
          name?: string | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_group?: boolean | null
          last_message_at?: string | null
          name?: string | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage: {
        Row: {
          analyst_name: string
          asset_id: string
          changed_by: string | null
          created_at: string | null
          created_by: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          is_lead: boolean | null
          notes: string | null
          organization_id: string | null
          portfolio_id: string | null
          role: string | null
          start_date: string | null
          team_id: string | null
          updated_at: string | null
          user_id: string
          visibility: string | null
        }
        Insert: {
          analyst_name?: string
          asset_id: string
          changed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_lead?: boolean | null
          notes?: string | null
          organization_id?: string | null
          portfolio_id?: string | null
          role?: string | null
          start_date?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id: string
          visibility?: string | null
        }
        Update: {
          analyst_name?: string
          asset_id?: string
          changed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          is_lead?: boolean | null
          notes?: string | null
          organization_id?: string | null
          portfolio_id?: string | null
          role?: string | null
          start_date?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id?: string
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_history: {
        Row: {
          asset_id: string
          change_reason: string | null
          change_type: string
          changed_at: string | null
          changed_by: string | null
          coverage_id: string | null
          created_at: string | null
          id: string
          new_analyst_name: string | null
          new_end_date: string | null
          new_is_active: boolean | null
          new_start_date: string | null
          new_user_id: string | null
          old_analyst_name: string | null
          old_end_date: string | null
          old_is_active: boolean | null
          old_start_date: string | null
          old_user_id: string | null
          organization_id: string | null
        }
        Insert: {
          asset_id: string
          change_reason?: string | null
          change_type: string
          changed_at?: string | null
          changed_by?: string | null
          coverage_id?: string | null
          created_at?: string | null
          id?: string
          new_analyst_name?: string | null
          new_end_date?: string | null
          new_is_active?: boolean | null
          new_start_date?: string | null
          new_user_id?: string | null
          old_analyst_name?: string | null
          old_end_date?: string | null
          old_is_active?: boolean | null
          old_start_date?: string | null
          old_user_id?: string | null
          organization_id?: string | null
        }
        Update: {
          asset_id?: string
          change_reason?: string | null
          change_type?: string
          changed_at?: string | null
          changed_by?: string | null
          coverage_id?: string | null
          created_at?: string | null
          id?: string
          new_analyst_name?: string | null
          new_end_date?: string | null
          new_is_active?: boolean | null
          new_start_date?: string | null
          new_user_id?: string | null
          old_analyst_name?: string | null
          old_end_date?: string | null
          old_is_active?: boolean | null
          old_start_date?: string | null
          old_user_id?: string | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_coverage_id_fkey"
            columns: ["coverage_id"]
            isOneToOne: false
            referencedRelation: "coverage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_new_user_id_fkey"
            columns: ["new_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_old_user_id_fkey"
            columns: ["old_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_portfolios: {
        Row: {
          coverage_id: string
          created_at: string | null
          id: string
          portfolio_id: string
        }
        Insert: {
          coverage_id: string
          created_at?: string | null
          id?: string
          portfolio_id: string
        }
        Update: {
          coverage_id?: string
          created_at?: string | null
          id?: string
          portfolio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_portfolios_coverage_id_fkey"
            columns: ["coverage_id"]
            isOneToOne: false
            referencedRelation: "coverage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_portfolios_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requests: {
        Row: {
          asset_id: string
          created_at: string | null
          current_analyst_name: string | null
          current_user_id: string | null
          id: string
          organization_id: string | null
          reason: string
          request_type: string
          requested_analyst_name: string
          requested_by: string
          requested_user_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          current_analyst_name?: string | null
          current_user_id?: string | null
          id?: string
          organization_id?: string | null
          reason: string
          request_type: string
          requested_analyst_name: string
          requested_by: string
          requested_user_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          current_analyst_name?: string | null
          current_user_id?: string | null
          id?: string
          organization_id?: string | null
          reason?: string
          request_type?: string
          requested_analyst_name?: string
          requested_by?: string
          requested_user_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_current_user_id_fkey"
            columns: ["current_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_requested_user_id_fkey"
            columns: ["requested_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_roles: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          organization_id: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          organization_id: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          organization_id?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_settings: {
        Row: {
          allow_multiple_coverage: boolean | null
          created_at: string | null
          default_visibility: string | null
          enable_hierarchy: boolean | null
          hierarchy_levels: Json | null
          id: string
          organization_id: string | null
          updated_at: string | null
          updated_by: string | null
          visibility_change_permission: string | null
        }
        Insert: {
          allow_multiple_coverage?: boolean | null
          created_at?: string | null
          default_visibility?: string | null
          enable_hierarchy?: boolean | null
          hierarchy_levels?: Json | null
          id?: string
          organization_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          visibility_change_permission?: string | null
        }
        Update: {
          allow_multiple_coverage?: boolean | null
          created_at?: string | null
          default_visibility?: string | null
          enable_hierarchy?: boolean | null
          hierarchy_levels?: Json | null
          id?: string
          organization_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          visibility_change_permission?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_notebook_notes: {
        Row: {
          content: string
          content_preview: string | null
          created_at: string | null
          created_by: string | null
          custom_notebook_id: string
          id: string
          is_deleted: boolean
          is_shared: boolean | null
          metadata: Json | null
          note_type: Database["public"]["Enums"]["note_type"] | null
          organization_id: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_notebook_id: string
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_notebook_id?: string
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_notebook_notes_custom_notebook_id_fkey"
            columns: ["custom_notebook_id"]
            isOneToOne: false
            referencedRelation: "custom_notebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_notebook_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_notebook_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_notebooks: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_notebooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_price_snapshots: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          portfolio_id: string | null
          price_source: string
          snapshot_at: string
          snapshot_price: number
          snapshot_type: string
          trade_queue_item_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          portfolio_id?: string | null
          price_source?: string
          snapshot_at?: string
          snapshot_price: number
          snapshot_type: string
          trade_queue_item_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          portfolio_id?: string | null
          price_source?: string
          snapshot_at?: string
          snapshot_price?: number
          snapshot_type?: string
          trade_queue_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_price_snapshots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_price_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_price_snapshots_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_price_snapshots_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_request_comments: {
        Row: {
          comment_type: string
          content: string
          created_at: string
          decision_request_id: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          comment_type?: string
          content: string
          created_at?: string
          decision_request_id: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          comment_type?: string
          content?: string
          created_at?: string
          decision_request_id?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_request_comments_decision_request_id_fkey"
            columns: ["decision_request_id"]
            isOneToOne: false
            referencedRelation: "decision_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_requests: {
        Row: {
          accepted_trade_id: string | null
          context_note: string | null
          created_at: string | null
          decision_note: string | null
          deferred_trigger: Json | null
          deferred_until: string | null
          id: string
          portfolio_id: string
          proposal_id: string | null
          requested_action: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          sizing_mode: string | null
          sizing_shares: number | null
          sizing_weight: number | null
          status: string
          submission_snapshot: Json | null
          trade_queue_item_id: string
          updated_at: string | null
          urgency: string
        }
        Insert: {
          accepted_trade_id?: string | null
          context_note?: string | null
          created_at?: string | null
          decision_note?: string | null
          deferred_trigger?: Json | null
          deferred_until?: string | null
          id?: string
          portfolio_id: string
          proposal_id?: string | null
          requested_action?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sizing_mode?: string | null
          sizing_shares?: number | null
          sizing_weight?: number | null
          status?: string
          submission_snapshot?: Json | null
          trade_queue_item_id: string
          updated_at?: string | null
          urgency?: string
        }
        Update: {
          accepted_trade_id?: string | null
          context_note?: string | null
          created_at?: string | null
          decision_note?: string | null
          deferred_trigger?: Json | null
          deferred_until?: string | null
          id?: string
          portfolio_id?: string
          proposal_id?: string | null
          requested_action?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sizing_mode?: string | null
          sizing_shares?: number | null
          sizing_weight?: number | null
          status?: string
          submission_snapshot?: Json | null
          trade_queue_item_id?: string
          updated_at?: string | null
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_requests_accepted_trade_id_fkey"
            columns: ["accepted_trade_id"]
            isOneToOne: false
            referencedRelation: "accepted_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_requests_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_requests_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_requests_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_reviews: {
        Row: {
          created_at: string
          decision_id: string
          decision_quality: string | null
          id: string
          process_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sizing_quality: string | null
          thesis_played_out: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision_id: string
          decision_quality?: string | null
          id?: string
          process_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sizing_quality?: string | null
          thesis_played_out?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision_id?: string
          decision_quality?: string | null
          id?: string
          process_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sizing_quality?: string | null
          thesis_played_out?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deliverable_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          deliverable_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          deliverable_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          deliverable_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_assignments_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "project_deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_metrics: {
        Row: {
          created_at: string | null
          format: string
          id: string
          is_default: boolean | null
          key: string
          label: string
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          created_at?: string | null
          format?: string
          id?: string
          is_default?: boolean | null
          key: string
          label: string
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          created_at?: string | null
          format?: string
          id?: string
          is_default?: boolean | null
          key?: string
          label?: string
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      external_calendar_events: {
        Row: {
          calendar_event_id: string | null
          connected_calendar_id: string
          created_at: string | null
          external_event_id: string
          external_ical_uid: string | null
          external_updated_at: string | null
          id: string
          local_updated_at: string | null
          raw_event_data: Json | null
          sync_error: string | null
          sync_status: string | null
          updated_at: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          connected_calendar_id: string
          created_at?: string | null
          external_event_id: string
          external_ical_uid?: string | null
          external_updated_at?: string | null
          id?: string
          local_updated_at?: string | null
          raw_event_data?: Json | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          connected_calendar_id?: string
          created_at?: string | null
          external_event_id?: string
          external_ical_uid?: string | null
          external_updated_at?: string | null
          id?: string
          local_updated_at?: string | null
          raw_event_data?: Json | null
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_calendar_events_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_calendar_events_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "org_calendar_events_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_calendar_events_connected_calendar_id_fkey"
            columns: ["connected_calendar_id"]
            isOneToOne: false
            referencedRelation: "connected_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      field_contribution_history: {
        Row: {
          changed_at: string | null
          changed_by: string
          contribution_id: string
          id: string
          new_content: string
          old_content: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by: string
          contribution_id: string
          id?: string
          new_content: string
          old_content?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string
          contribution_id?: string
          id?: string
          new_content?: string
          old_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_contribution_history_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "field_contributions"
            referencedColumns: ["id"]
          },
        ]
      }
      field_contributions: {
        Row: {
          asset_id: string
          attachments: Json | null
          content: string | null
          created_at: string | null
          draft_content: string | null
          draft_updated_at: string | null
          field_id: string
          id: string
          is_archived: boolean | null
          metadata: Json | null
          supporting_detail: string | null
          updated_at: string | null
          user_id: string
          visibility: string | null
        }
        Insert: {
          asset_id: string
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          draft_content?: string | null
          draft_updated_at?: string | null
          field_id: string
          id?: string
          is_archived?: boolean | null
          metadata?: Json | null
          supporting_detail?: string | null
          updated_at?: string | null
          user_id: string
          visibility?: string | null
        }
        Update: {
          asset_id?: string
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          draft_content?: string | null
          draft_updated_at?: string | null
          field_id?: string
          id?: string
          is_archived?: boolean | null
          metadata?: Json | null
          supporting_detail?: string | null
          updated_at?: string | null
          user_id?: string
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_contributions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_contributions_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "research_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      general_checklist_items: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          item_id: string
          item_text: string | null
          item_type: string | null
          sort_order: number | null
          stage_id: string
          status: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          item_id: string
          item_text?: string | null
          item_type?: string | null
          sort_order?: number | null
          stage_id: string
          status?: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          item_id?: string
          item_text?: string | null
          item_type?: string | null
          sort_order?: number | null
          stage_id?: string
          status?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      general_workflow_progress: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_stage_key: string | null
          id: string
          is_completed: boolean | null
          is_started: boolean
          started_at: string | null
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          started_at?: string | null
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          started_at?: string | null
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: true
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: true
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings_api_keys: {
        Row: {
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          permissions: string[] | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          permissions?: string[] | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          permissions?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings_integration_configs: {
        Row: {
          column_mapping_config_id: string | null
          consecutive_failures: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          integration_type: string
          is_active: boolean | null
          last_error: string | null
          last_run_at: string | null
          last_success_at: string | null
          name: string
          organization_id: string
          portfolio_id: string | null
          schedule_cron: string | null
          sftp_credentials_vault_id: string | null
          sftp_file_pattern: string | null
          sftp_host: string | null
          sftp_path: string | null
          sftp_port: number | null
          sftp_username: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          column_mapping_config_id?: string | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          integration_type: string
          is_active?: boolean | null
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          name: string
          organization_id: string
          portfolio_id?: string | null
          schedule_cron?: string | null
          sftp_credentials_vault_id?: string | null
          sftp_file_pattern?: string | null
          sftp_host?: string | null
          sftp_path?: string | null
          sftp_port?: number | null
          sftp_username?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          column_mapping_config_id?: string | null
          consecutive_failures?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          integration_type?: string
          is_active?: boolean | null
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          name?: string
          organization_id?: string
          portfolio_id?: string | null
          schedule_cron?: string | null
          sftp_credentials_vault_id?: string | null
          sftp_file_pattern?: string | null
          sftp_host?: string | null
          sftp_path?: string | null
          sftp_port?: number | null
          sftp_username?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_integration_configs_column_mapping_config_id_fkey"
            columns: ["column_mapping_config_id"]
            isOneToOne: false
            referencedRelation: "holdings_upload_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_integration_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_integration_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_integration_configs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings_integration_runs: {
        Row: {
          completed_at: string | null
          config_id: string
          created_at: string | null
          error_message: string | null
          file_name: string | null
          file_size: number | null
          id: string
          organization_id: string
          positions_count: number | null
          snapshot_id: string | null
          started_at: string | null
          status: string
          warnings: Json | null
        }
        Insert: {
          completed_at?: string | null
          config_id: string
          created_at?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          organization_id: string
          positions_count?: number | null
          snapshot_id?: string | null
          started_at?: string | null
          status?: string
          warnings?: Json | null
        }
        Update: {
          completed_at?: string | null
          config_id?: string
          created_at?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          organization_id?: string
          positions_count?: number | null
          snapshot_id?: string | null
          started_at?: string | null
          status?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_integration_runs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "holdings_integration_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_integration_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_integration_runs_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_holdings_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings_upload_configs: {
        Row: {
          column_mappings: Json
          created_at: string | null
          created_by: string | null
          date_format: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          portfolio_id: string | null
          skip_rows: number | null
          source_label: string | null
          updated_at: string | null
        }
        Insert: {
          column_mappings?: Json
          created_at?: string | null
          created_by?: string | null
          date_format?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          portfolio_id?: string | null
          skip_rows?: number | null
          source_label?: string | null
          updated_at?: string | null
        }
        Update: {
          column_mappings?: Json
          created_at?: string | null
          created_by?: string | null
          date_format?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          portfolio_id?: string | null
          skip_rows?: number | null
          source_label?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_upload_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_configs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings_upload_log: {
        Row: {
          config_id: string | null
          created_at: string | null
          errors: Json | null
          file_size: number | null
          filename: string
          id: string
          organization_id: string
          portfolio_id: string
          positions_count: number | null
          snapshot_date: string
          snapshot_id: string | null
          status: string
          uploaded_by: string
          warnings: Json | null
        }
        Insert: {
          config_id?: string | null
          created_at?: string | null
          errors?: Json | null
          file_size?: number | null
          filename: string
          id?: string
          organization_id: string
          portfolio_id: string
          positions_count?: number | null
          snapshot_date: string
          snapshot_id?: string | null
          status?: string
          uploaded_by: string
          warnings?: Json | null
        }
        Update: {
          config_id?: string | null
          created_at?: string | null
          errors?: Json | null
          file_size?: number | null
          filename?: string
          id?: string
          organization_id?: string
          portfolio_id?: string
          positions_count?: number | null
          snapshot_date?: string
          snapshot_id?: string | null
          status?: string
          uploaded_by?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_upload_log_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "holdings_upload_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_log_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_log_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_holdings_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holdings_upload_log_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_bookmarks: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          item_type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          item_type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          item_type?: string
          user_id?: string
        }
        Relationships: []
      }
      idea_reactions: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          item_type: string
          reaction: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          item_type: string
          reaction: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          item_type?: string
          reaction?: string
          user_id?: string
        }
        Relationships: []
      }
      individual_allocation_views: {
        Row: {
          asset_class_id: string
          conviction_level: number | null
          created_at: string | null
          id: string
          period_id: string
          rationale: string | null
          updated_at: string | null
          user_id: string
          view: Database["public"]["Enums"]["allocation_view"]
        }
        Insert: {
          asset_class_id: string
          conviction_level?: number | null
          created_at?: string | null
          id?: string
          period_id: string
          rationale?: string | null
          updated_at?: string | null
          user_id: string
          view: Database["public"]["Enums"]["allocation_view"]
        }
        Update: {
          asset_class_id?: string
          conviction_level?: number | null
          created_at?: string | null
          id?: string
          period_id?: string
          rationale?: string | null
          updated_at?: string | null
          user_id?: string
          view?: Database["public"]["Enums"]["allocation_view"]
        }
        Relationships: [
          {
            foreignKeyName: "individual_allocation_views_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "individual_allocation_views_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "individual_allocation_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_case_templates: {
        Row: {
          branding_config: Json | null
          cover_config: Json | null
          created_at: string | null
          description: string | null
          header_footer_config: Json | null
          id: string
          is_default: boolean | null
          is_shared: boolean | null
          last_used_at: string | null
          name: string
          organization_id: string | null
          section_config: Json | null
          style_config: Json | null
          toc_config: Json | null
          updated_at: string | null
          usage_count: number | null
          user_id: string
        }
        Insert: {
          branding_config?: Json | null
          cover_config?: Json | null
          created_at?: string | null
          description?: string | null
          header_footer_config?: Json | null
          id?: string
          is_default?: boolean | null
          is_shared?: boolean | null
          last_used_at?: string | null
          name: string
          organization_id?: string | null
          section_config?: Json | null
          style_config?: Json | null
          toc_config?: Json | null
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
        }
        Update: {
          branding_config?: Json | null
          cover_config?: Json | null
          created_at?: string | null
          description?: string | null
          header_footer_config?: Json | null
          id?: string
          is_default?: boolean | null
          is_shared?: boolean | null
          last_used_at?: string | null
          name?: string
          organization_id?: string | null
          section_config?: Json | null
          style_config?: Json | null
          toc_config?: Json | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_case_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_variants: {
        Row: {
          action: string
          active_weight_config: Json | null
          asset_id: string
          below_lot_warning: boolean
          computed: Json | null
          created_at: string
          created_by: string | null
          current_position: Json | null
          decision_request_id: string | null
          deleted_at: string | null
          direction_conflict: Json | null
          id: string
          lab_id: string
          notes: string | null
          portfolio_id: string
          proposal_id: string | null
          sizing_input: string
          sizing_spec: Json | null
          sort_order: number
          touched_in_lab_at: string | null
          trade_queue_item_id: string | null
          updated_at: string
          view_id: string | null
          visibility_tier: Database["public"]["Enums"]["visibility_tier"]
        }
        Insert: {
          action: string
          active_weight_config?: Json | null
          asset_id: string
          below_lot_warning?: boolean
          computed?: Json | null
          created_at?: string
          created_by?: string | null
          current_position?: Json | null
          decision_request_id?: string | null
          deleted_at?: string | null
          direction_conflict?: Json | null
          id?: string
          lab_id: string
          notes?: string | null
          portfolio_id: string
          proposal_id?: string | null
          sizing_input: string
          sizing_spec?: Json | null
          sort_order?: number
          touched_in_lab_at?: string | null
          trade_queue_item_id?: string | null
          updated_at?: string
          view_id?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Update: {
          action?: string
          active_weight_config?: Json | null
          asset_id?: string
          below_lot_warning?: boolean
          computed?: Json | null
          created_at?: string
          created_by?: string | null
          current_position?: Json | null
          decision_request_id?: string | null
          deleted_at?: string | null
          direction_conflict?: Json | null
          id?: string
          lab_id?: string
          notes?: string | null
          portfolio_id?: string
          proposal_id?: string | null
          sizing_input?: string
          sizing_spec?: Json | null
          sort_order?: number
          touched_in_lab_at?: string | null
          trade_queue_item_id?: string | null
          updated_at?: string
          view_id?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "lab_variants_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_decision_request_id_fkey"
            columns: ["decision_request_id"]
            isOneToOne: false
            referencedRelation: "decision_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_variants_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          layout_id: string
          org_node_id: string | null
          permission: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          layout_id: string
          org_node_id?: string | null
          permission?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          layout_id?: string
          org_node_id?: string | null
          permission?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "layout_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_collaborations_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "user_asset_page_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_collaborations_org_node_id_fkey"
            columns: ["org_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_collaborations_org_node_id_fkey"
            columns: ["org_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_collaborations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      list_item_tags: {
        Row: {
          created_at: string
          created_by: string | null
          list_item_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          list_item_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          list_item_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_item_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_item_tags_list_item_id_fkey"
            columns: ["list_item_id"]
            isOneToOne: false
            referencedRelation: "asset_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "list_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      list_kanban_boards: {
        Row: {
          created_at: string
          id: string
          list_id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_kanban_boards_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_kanban_lane_items: {
        Row: {
          asset_list_item_id: string
          board_id: string
          created_at: string
          id: string
          lane_id: string
        }
        Insert: {
          asset_list_item_id: string
          board_id: string
          created_at?: string
          id?: string
          lane_id: string
        }
        Update: {
          asset_list_item_id?: string
          board_id?: string
          created_at?: string
          id?: string
          lane_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_kanban_lane_items_asset_list_item_id_fkey"
            columns: ["asset_list_item_id"]
            isOneToOne: false
            referencedRelation: "asset_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_kanban_lane_items_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "list_kanban_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_kanban_lane_items_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "list_kanban_lanes"
            referencedColumns: ["id"]
          },
        ]
      }
      list_kanban_lanes: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_kanban_lanes_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "list_kanban_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      list_statuses: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          is_default_taxonomy: boolean
          list_id: string
          name: string
          sort_order: number
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_default_taxonomy?: boolean
          list_id: string
          name: string
          sort_order?: number
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_default_taxonomy?: boolean
          list_id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_statuses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_statuses_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          list_id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          list_id: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          list_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_tags_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          cited_content: string | null
          content: string
          context_id: string
          context_type: string
          created_at: string | null
          field_name: string | null
          id: string
          is_pinned: boolean | null
          is_read: boolean | null
          portfolio_id: string | null
          read_at: string | null
          reply_to: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cited_content?: string | null
          content: string
          context_id: string
          context_type: string
          created_at?: string | null
          field_name?: string | null
          id?: string
          is_pinned?: boolean | null
          is_read?: boolean | null
          portfolio_id?: string | null
          read_at?: string | null
          reply_to?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cited_content?: string | null
          content?: string
          context_id?: string
          context_type?: string
          created_at?: string | null
          field_name?: string | null
          id?: string
          is_pinned?: boolean | null
          is_read?: boolean | null
          portfolio_id?: string | null
          read_at?: string | null
          reply_to?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      model_files: {
        Row: {
          asset_id: string
          created_at: string | null
          extracted_data: Json | null
          file_size: number | null
          filename: string
          id: string
          is_latest: boolean | null
          mime_type: string | null
          previous_version_id: string | null
          snapshot_images: Json | null
          storage_path: string
          sync_error: string | null
          sync_status: string | null
          synced_at: string | null
          template_id: string | null
          updated_at: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          extracted_data?: Json | null
          file_size?: number | null
          filename: string
          id?: string
          is_latest?: boolean | null
          mime_type?: string | null
          previous_version_id?: string | null
          snapshot_images?: Json | null
          storage_path: string
          sync_error?: string | null
          sync_status?: string | null
          synced_at?: string | null
          template_id?: string | null
          updated_at?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          extracted_data?: Json | null
          file_size?: number | null
          filename?: string
          id?: string
          is_latest?: boolean | null
          mime_type?: string | null
          previous_version_id?: string | null
          snapshot_images?: Json | null
          storage_path?: string
          sync_error?: string | null
          sync_status?: string | null
          synced_at?: string | null
          template_id?: string | null
          updated_at?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "model_files_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_files_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "model_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_files_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "model_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_files_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      model_template_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          org_node_id: string | null
          permission: string
          team_id: string | null
          template_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          org_node_id?: string | null
          permission?: string
          team_id?: string | null
          template_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          org_node_id?: string | null
          permission?: string
          team_id?: string | null
          template_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_template_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_template_collaborations_org_node_id_fkey"
            columns: ["org_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_template_collaborations_org_node_id_fkey"
            columns: ["org_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_template_collaborations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_template_collaborations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "model_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_template_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      model_templates: {
        Row: {
          base_template_filename: string | null
          base_template_path: string | null
          base_template_size: number | null
          base_template_uploaded_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          detection_rules: Json | null
          dynamic_mappings: Json | null
          field_mappings: Json
          id: string
          is_firm_template: boolean | null
          name: string
          organization_id: string | null
          snapshot_ranges: Json | null
          updated_at: string | null
        }
        Insert: {
          base_template_filename?: string | null
          base_template_path?: string | null
          base_template_size?: number | null
          base_template_uploaded_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          detection_rules?: Json | null
          dynamic_mappings?: Json | null
          field_mappings?: Json
          id?: string
          is_firm_template?: boolean | null
          name: string
          organization_id?: string | null
          snapshot_ranges?: Json | null
          updated_at?: string | null
        }
        Update: {
          base_template_filename?: string | null
          base_template_path?: string | null
          base_template_size?: number | null
          base_template_uploaded_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          detection_rules?: Json | null
          dynamic_mappings?: Json | null
          field_mappings?: Json
          id?: string
          is_firm_template?: boolean | null
          name?: string
          organization_id?: string | null
          snapshot_ranges?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      model_versions: {
        Row: {
          change_summary: string | null
          created_at: string | null
          created_by: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          model_id: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string | null
          created_by: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          model_id: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string | null
          created_by?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          model_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "model_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_versions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "asset_models"
            referencedColumns: ["id"]
          },
        ]
      }
      morph_sessions: {
        Row: {
          admin_user_id: string
          created_at: string | null
          ended_at: string | null
          expires_at: string
          id: string
          is_active: boolean | null
          reason: string
          started_at: string | null
          target_org_id: string
          target_user_id: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string | null
          ended_at?: string | null
          expires_at: string
          id?: string
          is_active?: boolean | null
          reason: string
          started_at?: string | null
          target_org_id: string
          target_user_id: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string | null
          ended_at?: string | null
          expires_at?: string
          id?: string
          is_active?: boolean | null
          reason?: string
          started_at?: string | null
          target_org_id?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "morph_sessions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "morph_sessions_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "morph_sessions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      note_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          note_id: string
          note_type: string
          permission: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          note_id: string
          note_type: string
          permission?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          note_id?: string
          note_type?: string
          permission?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      note_versions: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          id: string
          is_pinned: boolean
          label: string | null
          note_id: string
          note_type: string
          note_type_category: string | null
          title: string
          version_number: number
          version_reason: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          label?: string | null
          note_id: string
          note_type: string
          note_type_category?: string | null
          title: string
          version_number?: number
          version_reason?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          label?: string | null
          note_id?: string
          note_type?: string
          note_type_category?: string | null
          title?: string
          version_number?: number
          version_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "note_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          context_data: Json | null
          context_id: string
          context_type: string
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          context_data?: Json | null
          context_id: string
          context_type: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          context_data?: Json | null
          context_id?: string
          context_type?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      object_links: {
        Row: {
          context: string | null
          created_at: string
          created_by: string | null
          id: string
          is_auto: boolean
          link_type: Database["public"]["Enums"]["link_relationship_type"]
          source_id: string
          source_type: Database["public"]["Enums"]["linkable_entity_type"]
          target_id: string
          target_type: Database["public"]["Enums"]["linkable_entity_type"]
        }
        Insert: {
          context?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_auto?: boolean
          link_type?: Database["public"]["Enums"]["link_relationship_type"]
          source_id: string
          source_type: Database["public"]["Enums"]["linkable_entity_type"]
          target_id: string
          target_type: Database["public"]["Enums"]["linkable_entity_type"]
        }
        Update: {
          context?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_auto?: boolean
          link_type?: Database["public"]["Enums"]["link_relationship_type"]
          source_id?: string
          source_type?: Database["public"]["Enums"]["linkable_entity_type"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["linkable_entity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "object_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      official_allocation_views: {
        Row: {
          approved_at: string | null
          asset_class_id: string
          created_at: string | null
          id: string
          notes: string | null
          period_id: string
          rationale: string | null
          set_by: string | null
          updated_at: string | null
          view: Database["public"]["Enums"]["allocation_view"]
        }
        Insert: {
          approved_at?: string | null
          asset_class_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          period_id: string
          rationale?: string | null
          set_by?: string | null
          updated_at?: string | null
          view: Database["public"]["Enums"]["allocation_view"]
        }
        Update: {
          approved_at?: string | null
          asset_class_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          period_id?: string
          rationale?: string | null
          set_by?: string | null
          updated_at?: string | null
          view?: Database["public"]["Enums"]["allocation_view"]
        }
        Relationships: [
          {
            foreignKeyName: "official_allocation_views_asset_class_id_fkey"
            columns: ["asset_class_id"]
            isOneToOne: false
            referencedRelation: "asset_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_allocation_views_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "allocation_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_allocation_views_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_chart_node_links: {
        Row: {
          created_at: string | null
          id: string
          linked_node_id: string
          node_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          linked_node_id: string
          node_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          linked_node_id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_chart_node_links_linked_node_id_fkey"
            columns: ["linked_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_links_linked_node_id_fkey"
            columns: ["linked_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_links_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_links_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      org_chart_node_members: {
        Row: {
          coverage_admin_blocked: boolean | null
          created_at: string | null
          created_by: string | null
          focus: string | null
          id: string
          is_coverage_admin: boolean | null
          node_id: string
          role: string
          user_id: string
        }
        Insert: {
          coverage_admin_blocked?: boolean | null
          created_at?: string | null
          created_by?: string | null
          focus?: string | null
          id?: string
          is_coverage_admin?: boolean | null
          node_id: string
          role: string
          user_id: string
        }
        Update: {
          coverage_admin_blocked?: boolean | null
          created_at?: string | null
          created_by?: string | null
          focus?: string | null
          id?: string
          is_coverage_admin?: boolean | null
          node_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_chart_node_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_members_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_members_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_node_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_chart_nodes: {
        Row: {
          color: string | null
          coverage_admin_override: boolean | null
          created_at: string | null
          created_by: string | null
          custom_type_label: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_non_investment: boolean | null
          name: string
          node_type: string
          organization_id: string
          parent_id: string | null
          settings: Json | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          coverage_admin_override?: boolean | null
          created_at?: string | null
          created_by?: string | null
          custom_type_label?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_non_investment?: boolean | null
          name: string
          node_type: string
          organization_id: string
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          coverage_admin_override?: boolean | null
          created_at?: string | null
          created_by?: string | null
          custom_type_label?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_non_investment?: boolean | null
          name?: string
          node_type?: string
          organization_id?: string
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_chart_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      org_export_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          error: string | null
          error_code: string | null
          error_message: string | null
          file_path: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_attempt_at: string | null
          organization_id: string
          requested_by: string
          result_bytes: number | null
          result_expires_at: string | null
          result_url: string | null
          scope: string
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          error_code?: string | null
          error_message?: string | null
          file_path?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          organization_id: string
          requested_by: string
          result_bytes?: number | null
          result_expires_at?: string | null
          result_url?: string | null
          scope?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          error_code?: string | null
          error_message?: string | null
          file_path?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          organization_id?: string
          requested_by?: string
          result_bytes?: number | null
          result_expires_at?: string | null
          result_url?: string | null
          scope?: string
          started_at?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_onboarding_status: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          current_step: number | null
          is_completed: boolean | null
          organization_id: string
          started_at: string | null
          steps_completed: Json | null
          steps_skipped: Json | null
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          current_step?: number | null
          is_completed?: boolean | null
          organization_id: string
          started_at?: string | null
          steps_completed?: Json | null
          steps_skipped?: Json | null
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          current_step?: number | null
          is_completed?: boolean | null
          organization_id?: string
          started_at?: string | null
          steps_completed?: Json | null
          steps_skipped?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_status_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_onboarding_status_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_ai_config: {
        Row: {
          byok_api_key: string | null
          byok_enabled: boolean
          byok_model: string | null
          byok_provider: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          byok_api_key?: string | null
          byok_enabled?: boolean
          byok_model?: string | null
          byok_provider?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          byok_api_key?: string | null
          byok_enabled?: boolean
          byok_model?: string | null
          byok_provider?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_ai_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_audit_log: {
        Row: {
          action: string
          action_type: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_type: string | null
          id: string
          initiator_user_id: string | null
          metadata: Json
          organization_id: string
          source_id: string | null
          source_type: string
          target_id: string | null
          target_type: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          action_type?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_type?: string | null
          id?: string
          initiator_user_id?: string | null
          metadata?: Json
          organization_id: string
          source_id?: string | null
          source_type?: string
          target_id?: string | null
          target_type: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          action_type?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_type?: string | null
          id?: string
          initiator_user_id?: string | null
          metadata?: Json
          organization_id?: string
          source_id?: string | null
          source_type?: string
          target_id?: string | null
          target_type?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_contacts: {
        Row: {
          company: string | null
          contact_type: string | null
          created_at: string | null
          created_by: string | null
          department: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          notes: string | null
          organization_id: string
          phone: string | null
          receives_reports: boolean | null
          report_preferences: Json | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          company?: string | null
          contact_type?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          receives_reports?: boolean | null
          report_preferences?: Json | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          company?: string | null
          contact_type?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          receives_reports?: boolean | null
          report_preferences?: Json | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_domains: {
        Row: {
          created_at: string
          created_by: string | null
          domain: string
          id: string
          organization_id: string
          status: string
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain: string
          id?: string
          organization_id: string
          status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string
          id?: string
          organization_id?: string
          status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_domains_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_governance: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_locked_at: string | null
          deletion_locked_by: string | null
          deletion_scheduled_at: string | null
          legal_hold: boolean
          organization_id: string
          retention_days_audit_log: number
          scorecard_visibility: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_locked_at?: string | null
          deletion_locked_by?: string | null
          deletion_scheduled_at?: string | null
          legal_hold?: boolean
          organization_id: string
          retention_days_audit_log?: number
          scorecard_visibility?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_locked_at?: string | null
          deletion_locked_by?: string | null
          deletion_scheduled_at?: string | null
          legal_hold?: boolean
          organization_id?: string
          retention_days_audit_log?: number
          scorecard_visibility?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_governance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_identity_providers: {
        Row: {
          client_id: string
          client_secret_encrypted: string | null
          created_at: string
          created_by: string | null
          discovery_url: string
          enabled: boolean
          id: string
          issuer: string | null
          organization_id: string
          provider_type: string
          sso_only: boolean
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          discovery_url: string
          enabled?: boolean
          id?: string
          issuer?: string | null
          organization_id: string
          provider_type?: string
          sso_only?: boolean
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          discovery_url?: string
          enabled?: boolean
          id?: string
          issuer?: string | null
          organization_id?: string
          provider_type?: string
          sso_only?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_identity_providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string | null
          id: string
          invited_by: string
          invited_is_org_admin: boolean
          organization_id: string
          preassignments: Json | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          invited_by: string
          invited_is_org_admin?: boolean
          organization_id: string
          preassignments?: Json | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string
          invited_is_org_admin?: boolean
          organization_id?: string
          preassignments?: Json | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_org_admin: boolean | null
          joined_at: string | null
          organization_id: string
          role: string
          role_id: string | null
          status: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_org_admin?: boolean | null
          joined_at?: string | null
          organization_id: string
          role?: string
          role_id?: string | null
          status?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_org_admin?: boolean | null
          joined_at?: string | null
          organization_id?: string
          role?: string
          role_id?: string | null
          status?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "user_role_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          onboarding_policy: string
          settings: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          onboarding_policy?: string
          settings?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          onboarding_policy?: string
          settings?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      outcome_preferences: {
        Row: {
          aggregation_method: string | null
          created_at: string | null
          default_timeframe: string | null
          id: string
          show_opinions: boolean | null
          updated_at: string | null
          user_id: string | null
          weight_by_role: boolean | null
        }
        Insert: {
          aggregation_method?: string | null
          created_at?: string | null
          default_timeframe?: string | null
          id?: string
          show_opinions?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          weight_by_role?: boolean | null
        }
        Update: {
          aggregation_method?: string | null
          created_at?: string | null
          default_timeframe?: string | null
          id?: string
          show_opinions?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          weight_by_role?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pair_trades: {
        Row: {
          alert_at: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          name: string
          portfolio_id: string
          previous_state: Json | null
          rationale: string | null
          revisit_at: string | null
          status: Database["public"]["Enums"]["trade_queue_status"] | null
          thesis_summary: string | null
          updated_at: string | null
          urgency: string | null
        }
        Insert: {
          alert_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          name?: string
          portfolio_id: string
          previous_state?: Json | null
          rationale?: string | null
          revisit_at?: string | null
          status?: Database["public"]["Enums"]["trade_queue_status"] | null
          thesis_summary?: string | null
          updated_at?: string | null
          urgency?: string | null
        }
        Update: {
          alert_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          name?: string
          portfolio_id?: string
          previous_state?: Json | null
          rationale?: string | null
          revisit_at?: string | null
          status?: Database["public"]["Enums"]["trade_queue_status"] | null
          thesis_summary?: string | null
          updated_at?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pair_trades_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pair_trades_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pair_trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_tasks: {
        Row: {
          category: string | null
          completed: boolean | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          due_time: string | null
          id: string
          linked_asset_id: string | null
          linked_project_id: string | null
          linked_workflow_id: string | null
          priority: string | null
          remind_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          linked_asset_id?: string | null
          linked_project_id?: string | null
          linked_workflow_id?: string | null
          priority?: string | null
          remind_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          linked_asset_id?: string | null
          linked_project_id?: string | null
          linked_workflow_id?: string | null
          priority?: string | null
          remind_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_tasks_linked_asset_id_fkey"
            columns: ["linked_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_linked_workflow_id_fkey"
            columns: ["linked_workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_linked_workflow_id_fkey"
            columns: ["linked_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_scenarios: {
        Row: {
          accepted_at: string | null
          asset_id: string | null
          assigned_at: string | null
          created_at: string
          created_by: string | null
          delta_weight_pct: number | null
          direction: string | null
          id: string
          is_template: boolean
          organization_id: string
          portfolio_id: string | null
          proposed_action: string | null
          proposed_sizing_input: string | null
          status: string
          symbol: string | null
          target_weight_pct: number | null
          thesis: string | null
          title: string
          trade_queue_item_id: string | null
          updated_at: string
          user_id: string | null
          why_now: string | null
        }
        Insert: {
          accepted_at?: string | null
          asset_id?: string | null
          assigned_at?: string | null
          created_at?: string
          created_by?: string | null
          delta_weight_pct?: number | null
          direction?: string | null
          id?: string
          is_template?: boolean
          organization_id: string
          portfolio_id?: string | null
          proposed_action?: string | null
          proposed_sizing_input?: string | null
          status?: string
          symbol?: string | null
          target_weight_pct?: number | null
          thesis?: string | null
          title: string
          trade_queue_item_id?: string | null
          updated_at?: string
          user_id?: string | null
          why_now?: string | null
        }
        Update: {
          accepted_at?: string | null
          asset_id?: string | null
          assigned_at?: string | null
          created_at?: string
          created_by?: string | null
          delta_weight_pct?: number | null
          direction?: string | null
          id?: string
          is_template?: boolean
          organization_id?: string
          portfolio_id?: string | null
          proposed_action?: string | null
          proposed_sizing_input?: string | null
          status?: string
          symbol?: string | null
          target_weight_pct?: number | null
          thesis?: string | null
          title?: string
          trade_queue_item_id?: string | null
          updated_at?: string
          user_id?: string | null
          why_now?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_scenarios_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_scenarios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_scenarios_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_scenarios_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_telemetry_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          organization_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_ai_config: {
        Row: {
          allow_byok: boolean | null
          created_at: string | null
          daily_request_limit: number | null
          daily_token_limit_per_user: number | null
          id: string
          max_tokens_per_request: number | null
          monthly_budget_usd_per_user: number | null
          monthly_request_limit: number | null
          platform_ai_enabled: boolean | null
          platform_model: string | null
          platform_provider: string | null
          updated_at: string | null
        }
        Insert: {
          allow_byok?: boolean | null
          created_at?: string | null
          daily_request_limit?: number | null
          daily_token_limit_per_user?: number | null
          id?: string
          max_tokens_per_request?: number | null
          monthly_budget_usd_per_user?: number | null
          monthly_request_limit?: number | null
          platform_ai_enabled?: boolean | null
          platform_model?: string | null
          platform_provider?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_byok?: boolean | null
          created_at?: string | null
          daily_request_limit?: number | null
          daily_token_limit_per_user?: number | null
          id?: string
          max_tokens_per_request?: number | null
          monthly_budget_usd_per_user?: number | null
          monthly_request_limit?: number | null
          platform_ai_enabled?: boolean | null
          platform_model?: string | null
          platform_provider?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      portfolio_benchmark_weights: {
        Row: {
          as_of_date: string | null
          asset_id: string
          created_at: string
          id: string
          portfolio_id: string
          source: string
          updated_at: string
          weight: number
        }
        Insert: {
          as_of_date?: string | null
          asset_id: string
          created_at?: string
          id?: string
          portfolio_id: string
          source?: string
          updated_at?: string
          weight: number
        }
        Update: {
          as_of_date?: string | null
          asset_id?: string
          created_at?: string
          id?: string
          portfolio_id?: string
          source?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_benchmark_weights_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_benchmark_weights_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_checklist_attachments: {
        Row: {
          created_at: string | null
          description: string | null
          evidence_type: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          item_id: string
          portfolio_id: string
          stage_id: string
          uploaded_by: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          evidence_type?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          item_id: string
          portfolio_id: string
          stage_id: string
          uploaded_by?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          evidence_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          item_id?: string
          portfolio_id?: string
          stage_id?: string
          uploaded_by?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_checklist_attachments_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_checklist_attachments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_checklist_attachments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_checklist_items: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          item_id: string
          item_text: string | null
          item_type: string | null
          portfolio_id: string
          sort_order: number | null
          stage_id: string
          status: string
          takeaway: string | null
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          item_id: string
          item_text?: string | null
          item_type?: string | null
          portfolio_id: string
          sort_order?: number | null
          stage_id: string
          status?: string
          takeaway?: string | null
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          item_id?: string
          item_text?: string | null
          item_type?: string | null
          portfolio_id?: string
          sort_order?: number | null
          stage_id?: string
          status?: string
          takeaway?: string | null
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_checklist_items_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_checklist_items_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_holdings: {
        Row: {
          asset_id: string
          cost: number
          created_at: string | null
          created_by: string | null
          date: string
          id: string
          portfolio_id: string
          price: number
          shares: number
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          cost?: number
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          portfolio_id: string
          price?: number
          shares?: number
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          cost?: number
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          portfolio_id?: string
          price?: number
          shares?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_holdings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_holdings_positions: {
        Row: {
          asset_class: string | null
          asset_id: string | null
          cost_basis: number | null
          created_at: string | null
          id: string
          market_value: number | null
          organization_id: string | null
          portfolio_id: string
          price: number | null
          sector: string | null
          shares: number
          snapshot_id: string
          symbol: string
          weight_pct: number | null
        }
        Insert: {
          asset_class?: string | null
          asset_id?: string | null
          cost_basis?: number | null
          created_at?: string | null
          id?: string
          market_value?: number | null
          organization_id?: string | null
          portfolio_id: string
          price?: number | null
          sector?: string | null
          shares?: number
          snapshot_id: string
          symbol: string
          weight_pct?: number | null
        }
        Update: {
          asset_class?: string | null
          asset_id?: string | null
          cost_basis?: number | null
          created_at?: string | null
          id?: string
          market_value?: number | null
          organization_id?: string | null
          portfolio_id?: string
          price?: number | null
          sector?: string | null
          shares?: number
          snapshot_id?: string
          symbol?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_holdings_positions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_positions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_positions_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_holdings_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_holdings_snapshots: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          organization_id: string | null
          portfolio_id: string
          snapshot_date: string
          source: string
          total_market_value: number | null
          total_positions: number | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          portfolio_id: string
          snapshot_date: string
          source?: string
          total_market_value?: number | null
          total_positions?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          portfolio_id?: string
          snapshot_date?: string
          source?: string
          total_market_value?: number | null
          total_positions?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_holdings_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_snapshots_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_holdings_snapshots_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_memberships: {
        Row: {
          access_permissions: Json | null
          created_at: string | null
          id: string
          is_portfolio_manager: boolean | null
          joined_at: string | null
          portfolio_id: string
          role_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_permissions?: Json | null
          created_at?: string | null
          id?: string
          is_portfolio_manager?: boolean | null
          joined_at?: string | null
          portfolio_id: string
          role_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_permissions?: Json | null
          created_at?: string | null
          id?: string
          is_portfolio_manager?: boolean | null
          joined_at?: string | null
          portfolio_id?: string
          role_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_memberships_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "user_role_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_notes: {
        Row: {
          content: string
          content_preview: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_deleted: boolean
          is_shared: boolean | null
          metadata: Json | null
          note_type: Database["public"]["Enums"]["note_type"] | null
          organization_id: string | null
          portfolio_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          portfolio_id: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          portfolio_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_notes_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_team: {
        Row: {
          created_at: string
          focus: string | null
          id: string
          portfolio_id: string
          role: string
          source_team_node_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          focus?: string | null
          id?: string
          portfolio_id: string
          role: string
          source_team_node_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          focus?: string | null
          id?: string
          portfolio_id?: string
          role?: string
          source_team_node_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_team_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_team_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_team_links: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_lead: boolean | null
          organization_id: string
          portfolio_id: string
          team_node_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_lead?: boolean | null
          organization_id: string
          portfolio_id: string
          team_node_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_lead?: boolean | null
          organization_id?: string
          portfolio_id?: string
          team_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_team_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_team_links_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_team_links_team_node_id_fkey"
            columns: ["team_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_team_links_team_node_id_fkey"
            columns: ["team_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_trade_events: {
        Row: {
          action_type: Database["public"]["Enums"]["trade_event_action"]
          asset_id: string
          created_at: string
          created_by: string | null
          detected_at: string
          detected_by_system: boolean
          event_date: string
          id: string
          linked_decision_id: string | null
          linked_proposal_id: string | null
          linked_trade_idea_id: string | null
          linked_trade_sheet_id: string | null
          market_value_after: number | null
          market_value_before: number | null
          metadata: Json | null
          portfolio_id: string
          quantity_after: number | null
          quantity_before: number | null
          quantity_delta: number | null
          source_type: Database["public"]["Enums"]["trade_event_source"]
          status: Database["public"]["Enums"]["trade_event_status"]
          updated_at: string
          updated_by: string | null
          weight_after: number | null
          weight_before: number | null
          weight_delta: number | null
        }
        Insert: {
          action_type?: Database["public"]["Enums"]["trade_event_action"]
          asset_id: string
          created_at?: string
          created_by?: string | null
          detected_at?: string
          detected_by_system?: boolean
          event_date?: string
          id?: string
          linked_decision_id?: string | null
          linked_proposal_id?: string | null
          linked_trade_idea_id?: string | null
          linked_trade_sheet_id?: string | null
          market_value_after?: number | null
          market_value_before?: number | null
          metadata?: Json | null
          portfolio_id: string
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_delta?: number | null
          source_type?: Database["public"]["Enums"]["trade_event_source"]
          status?: Database["public"]["Enums"]["trade_event_status"]
          updated_at?: string
          updated_by?: string | null
          weight_after?: number | null
          weight_before?: number | null
          weight_delta?: number | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["trade_event_action"]
          asset_id?: string
          created_at?: string
          created_by?: string | null
          detected_at?: string
          detected_by_system?: boolean
          event_date?: string
          id?: string
          linked_decision_id?: string | null
          linked_proposal_id?: string | null
          linked_trade_idea_id?: string | null
          linked_trade_sheet_id?: string | null
          market_value_after?: number | null
          market_value_before?: number | null
          metadata?: Json | null
          portfolio_id?: string
          quantity_after?: number | null
          quantity_before?: number | null
          quantity_delta?: number | null
          source_type?: Database["public"]["Enums"]["trade_event_source"]
          status?: Database["public"]["Enums"]["trade_event_status"]
          updated_at?: string
          updated_by?: string | null
          weight_after?: number | null
          weight_before?: number | null
          weight_delta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_trade_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_trade_events_linked_trade_idea_id_fkey"
            columns: ["linked_trade_idea_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_trade_events_linked_trade_sheet_id_fkey"
            columns: ["linked_trade_sheet_id"]
            isOneToOne: false
            referencedRelation: "trade_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_trade_events_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_trades: {
        Row: {
          asset_id: string
          created_at: string | null
          created_by: string | null
          id: string
          portfolio_id: string
          price: number
          shares: number
          total_value: number | null
          trade_date: string
          trade_type: string
          weight_after: number | null
          weight_before: number | null
          weight_change: number | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          portfolio_id: string
          price: number
          shares: number
          total_value?: number | null
          trade_date: string
          trade_type: string
          weight_after?: number | null
          weight_before?: number | null
          weight_change?: number | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          portfolio_id?: string
          price?: number
          shares?: number
          total_value?: number | null
          trade_date?: string
          trade_type?: string
          weight_after?: number | null
          weight_before?: number | null
          weight_change?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_trades_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_trades_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_universe_assets: {
        Row: {
          added_at: string | null
          added_by: string | null
          asset_id: string
          id: string
          notes: string | null
          portfolio_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          asset_id: string
          id?: string
          notes?: string | null
          portfolio_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          asset_id?: string
          id?: string
          notes?: string | null
          portfolio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_universe_assets_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_universe_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_universe_assets_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_universe_filters: {
        Row: {
          created_at: string | null
          created_by: string | null
          filter_operator: string
          filter_type: string
          filter_value: string
          id: string
          portfolio_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          filter_operator?: string
          filter_type: string
          filter_value: string
          id?: string
          portfolio_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          filter_operator?: string
          filter_type?: string
          filter_value?: string
          id?: string
          portfolio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_universe_filters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_universe_filters_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_workflow_progress: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_stage_key: string | null
          id: string
          is_completed: boolean | null
          is_started: boolean
          portfolio_id: string
          started_at: string | null
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          portfolio_id: string
          started_at?: string | null
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean | null
          is_started?: boolean
          portfolio_id?: string
          started_at?: string | null
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_workflow_progress_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          benchmark: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          discarded_at: string | null
          discarded_by: string | null
          holdings_source: Database["public"]["Enums"]["holdings_source_type"]
          id: string
          inception_date: string | null
          is_active: boolean | null
          lifecycle_reason: string | null
          name: string
          organization_id: string | null
          portfolio_id: string | null
          portfolio_type: string | null
          reconciliation_inactivity_days: number
          rounding_config: Json
          settings: Json | null
          slug: string | null
          status: string
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          benchmark?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          holdings_source?: Database["public"]["Enums"]["holdings_source_type"]
          id?: string
          inception_date?: string | null
          is_active?: boolean | null
          lifecycle_reason?: string | null
          name: string
          organization_id?: string | null
          portfolio_id?: string | null
          portfolio_type?: string | null
          reconciliation_inactivity_days?: number
          rounding_config?: Json
          settings?: Json | null
          slug?: string | null
          status?: string
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          benchmark?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          holdings_source?: Database["public"]["Enums"]["holdings_source_type"]
          id?: string
          inception_date?: string | null
          is_active?: boolean | null
          lifecycle_reason?: string | null
          name?: string
          organization_id?: string | null
          portfolio_id?: string | null
          portfolio_type?: string | null
          reconciliation_inactivity_days?: number
          rounding_config?: Json
          settings?: Json | null
          slug?: string | null
          status?: string
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolios_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history_cache: {
        Row: {
          close: number
          created_at: string | null
          date: string
          fetched_at: string | null
          high: number | null
          id: string
          low: number | null
          open: number | null
          source: string | null
          symbol: string
          volume: number | null
        }
        Insert: {
          close: number
          created_at?: string | null
          date: string
          fetched_at?: string | null
          high?: number | null
          id?: string
          low?: number | null
          open?: number | null
          source?: string | null
          symbol: string
          volume?: number | null
        }
        Update: {
          close?: number
          created_at?: string | null
          date?: string
          fetched_at?: string | null
          high?: number | null
          id?: string
          low?: number | null
          open?: number | null
          source?: string | null
          symbol?: string
          volume?: number | null
        }
        Relationships: []
      }
      price_target_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          price_target_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          price_target_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          price_target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_target_history_price_target_id_fkey"
            columns: ["price_target_id"]
            isOneToOne: false
            referencedRelation: "price_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      price_target_outcomes: {
        Row: {
          accuracy_pct: number | null
          asset_id: string
          created_at: string | null
          days_to_hit: number | null
          evaluated_at: string | null
          hit_date: string | null
          hit_price: number | null
          id: string
          notes: string | null
          overshoot_pct: number | null
          price_at_expiry: number | null
          price_target_id: string
          scenario_id: string | null
          scenario_type: string | null
          status: string
          target_date: string
          target_price: number
          target_set_date: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          accuracy_pct?: number | null
          asset_id: string
          created_at?: string | null
          days_to_hit?: number | null
          evaluated_at?: string | null
          hit_date?: string | null
          hit_price?: number | null
          id?: string
          notes?: string | null
          overshoot_pct?: number | null
          price_at_expiry?: number | null
          price_target_id: string
          scenario_id?: string | null
          scenario_type?: string | null
          status?: string
          target_date: string
          target_price: number
          target_set_date: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          accuracy_pct?: number | null
          asset_id?: string
          created_at?: string | null
          days_to_hit?: number | null
          evaluated_at?: string | null
          hit_date?: string | null
          hit_price?: number | null
          id?: string
          notes?: string | null
          overshoot_pct?: number | null
          price_at_expiry?: number | null
          price_target_id?: string
          scenario_id?: string | null
          scenario_type?: string | null
          status?: string
          target_date?: string
          target_price?: number
          target_set_date?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_target_outcomes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_target_outcomes_price_target_id_fkey"
            columns: ["price_target_id"]
            isOneToOne: true
            referencedRelation: "analyst_price_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_target_outcomes_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_target_outcomes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      price_targets: {
        Row: {
          asset_id: string
          created_at: string | null
          created_by: string | null
          id: string
          organization_id: string | null
          price: number
          reasoning: string | null
          timeframe: string | null
          type: Database["public"]["Enums"]["price_target_type"]
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          organization_id?: string | null
          price: number
          reasoning?: string | null
          timeframe?: string | null
          type: Database["public"]["Enums"]["price_target_type"]
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          organization_id?: string | null
          price?: number
          reasoning?: string | null
          timeframe?: string | null
          type?: Database["public"]["Enums"]["price_target_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_targets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activity: {
        Row: {
          activity_type: string
          actor_id: string | null
          created_at: string
          field_name: string | null
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          project_id: string
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          created_at?: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          project_id: string
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          created_at?: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assigned_to: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_assignment_role"]
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_assignment_role"]
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_assignment_role"]
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_attachments: {
        Row: {
          content_type: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          project_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          project_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          project_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collections: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          description: string | null
          filter_criteria: Json
          icon: string | null
          id: string
          is_pinned: boolean | null
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          filter_criteria?: Json
          icon?: string | null
          id?: string
          is_pinned?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          filter_criteria?: Json
          icon?: string | null
          id?: string
          is_pinned?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      project_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          reaction_type: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "project_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comment_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          parent_id: string | null
          project_id: string
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          parent_id?: string | null
          project_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          parent_id?: string | null
          project_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_contexts: {
        Row: {
          context_id: string
          context_type: string
          created_at: string
          created_by: string | null
          id: string
          project_id: string
        }
        Insert: {
          context_id: string
          context_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
        }
        Update: {
          context_id?: string
          context_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contexts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contexts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_deliverables: {
        Row: {
          assigned_to: string | null
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          display_order: number
          due_date: string | null
          id: string
          project_id: string
          source_comment_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          project_id: string
          source_comment_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          project_id?: string
          source_comment_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_deliverables_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_deliverables_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_deliverables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_deliverables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_deliverables_source_comment_id_fkey"
            columns: ["source_comment_id"]
            isOneToOne: false
            referencedRelation: "project_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      project_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          dependency_type: string
          depends_on_deliverable_id: string | null
          depends_on_id: string | null
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dependency_type?: string
          depends_on_deliverable_id?: string | null
          depends_on_id?: string | null
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dependency_type?: string
          depends_on_deliverable_id?: string | null
          depends_on_id?: string | null
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_depends_on_deliverable_id_fkey"
            columns: ["depends_on_deliverable_id"]
            isOneToOne: false
            referencedRelation: "project_deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_org_groups: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          org_group_id: string
          project_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          org_group_id: string
          project_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          org_group_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_org_groups_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_org_groups_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_org_groups_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_org_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_org_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tag_assignments: {
        Row: {
          created_at: string
          id: string
          project_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tag_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tag_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "project_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      project_teams: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          member_ids: string[]
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          member_ids?: string[]
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          member_ids?: string[]
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          blocked_reason: string | null
          board_position: number | null
          completed_at: string | null
          context_id: string | null
          context_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          org_group_id: string | null
          organization_id: string
          priority: Database["public"]["Enums"]["project_priority"]
          status: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          board_position?: number | null
          completed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_group_id?: string | null
          organization_id: string
          priority?: Database["public"]["Enums"]["project_priority"]
          status?: Database["public"]["Enums"]["project_status"]
          title: string
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          board_position?: number | null
          completed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_group_id?: string | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["project_priority"]
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_thought_topics: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          quick_thought_id: string
          topic_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          quick_thought_id: string
          topic_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          quick_thought_id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_thought_topics_quick_thought_id_fkey"
            columns: ["quick_thought_id"]
            isOneToOne: false
            referencedRelation: "quick_thoughts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thought_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "org_topics_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thought_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_thoughts: {
        Row: {
          asset_id: string | null
          attachments: Json | null
          chart_snapshot: Json | null
          content: string
          converted_to_note_id: string | null
          created_at: string | null
          created_by: string
          date_type: Database["public"]["Enums"]["thought_date_type"] | null
          expires_at: string | null
          id: string
          idea_type: Database["public"]["Enums"]["idea_type"] | null
          is_archived: boolean | null
          is_pinned: boolean | null
          organization_id: string | null
          parent_thought_id: string | null
          portfolio_id: string | null
          project_id: string | null
          promoted_to_trade_idea_id: string | null
          revisit_date: string | null
          sentiment: Database["public"]["Enums"]["thought_sentiment"] | null
          source_snippet: string | null
          source_title: string | null
          source_type: Database["public"]["Enums"]["thought_source_type"] | null
          source_url: string | null
          tags: string[] | null
          theme_id: string | null
          ticker_mentions: string[] | null
          updated_at: string | null
          visibility: Database["public"]["Enums"]["thought_visibility"] | null
          visibility_org_id: string | null
          visibility_org_node_id: string | null
          visibility_portfolio_id: string | null
          visibility_team_id: string | null
        }
        Insert: {
          asset_id?: string | null
          attachments?: Json | null
          chart_snapshot?: Json | null
          content: string
          converted_to_note_id?: string | null
          created_at?: string | null
          created_by: string
          date_type?: Database["public"]["Enums"]["thought_date_type"] | null
          expires_at?: string | null
          id?: string
          idea_type?: Database["public"]["Enums"]["idea_type"] | null
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          parent_thought_id?: string | null
          portfolio_id?: string | null
          project_id?: string | null
          promoted_to_trade_idea_id?: string | null
          revisit_date?: string | null
          sentiment?: Database["public"]["Enums"]["thought_sentiment"] | null
          source_snippet?: string | null
          source_title?: string | null
          source_type?:
            | Database["public"]["Enums"]["thought_source_type"]
            | null
          source_url?: string | null
          tags?: string[] | null
          theme_id?: string | null
          ticker_mentions?: string[] | null
          updated_at?: string | null
          visibility?: Database["public"]["Enums"]["thought_visibility"] | null
          visibility_org_id?: string | null
          visibility_org_node_id?: string | null
          visibility_portfolio_id?: string | null
          visibility_team_id?: string | null
        }
        Update: {
          asset_id?: string | null
          attachments?: Json | null
          chart_snapshot?: Json | null
          content?: string
          converted_to_note_id?: string | null
          created_at?: string | null
          created_by?: string
          date_type?: Database["public"]["Enums"]["thought_date_type"] | null
          expires_at?: string | null
          id?: string
          idea_type?: Database["public"]["Enums"]["idea_type"] | null
          is_archived?: boolean | null
          is_pinned?: boolean | null
          organization_id?: string | null
          parent_thought_id?: string | null
          portfolio_id?: string | null
          project_id?: string | null
          promoted_to_trade_idea_id?: string | null
          revisit_date?: string | null
          sentiment?: Database["public"]["Enums"]["thought_sentiment"] | null
          source_snippet?: string | null
          source_title?: string | null
          source_type?:
            | Database["public"]["Enums"]["thought_source_type"]
            | null
          source_url?: string | null
          tags?: string[] | null
          theme_id?: string | null
          ticker_mentions?: string[] | null
          updated_at?: string | null
          visibility?: Database["public"]["Enums"]["thought_visibility"] | null
          visibility_org_id?: string | null
          visibility_org_node_id?: string | null
          visibility_portfolio_id?: string | null
          visibility_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quick_thoughts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_parent_thought_id_fkey"
            columns: ["parent_thought_id"]
            isOneToOne: false
            referencedRelation: "quick_thoughts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "org_projects_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_promoted_to_trade_idea_id_fkey"
            columns: ["promoted_to_trade_idea_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_visibility_org_id_fkey"
            columns: ["visibility_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_visibility_org_node_id_fkey"
            columns: ["visibility_org_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_visibility_org_node_id_fkey"
            columns: ["visibility_org_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_visibility_portfolio_id_fkey"
            columns: ["visibility_portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_thoughts_visibility_team_id_fkey"
            columns: ["visibility_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_ev_suppressions: {
        Row: {
          asset_id: string
          created_at: string | null
          id: string
          suppressed_until: string
          user_id: string
          view_scope_type: string
          view_scope_user_id: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          id?: string
          suppressed_until: string
          user_id: string
          view_scope_type?: string
          view_scope_user_id?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          id?: string
          suppressed_until?: string
          user_id?: string
          view_scope_type?: string
          view_scope_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rating_ev_suppressions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_scales: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean | null
          is_system: boolean | null
          name: string
          organization_id: string | null
          values: Json
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          name: string
          organization_id?: string | null
          values: Json
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          is_system?: boolean | null
          name?: string
          organization_id?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rating_scales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_scales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          deviated_count: number
          holdings_upload_id: string | null
          id: string
          matched_count: number
          notes: string | null
          partial_count: number
          portfolio_id: string
          reviewer_id: string | null
          started_at: string
          unmatched_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deviated_count?: number
          holdings_upload_id?: string | null
          id?: string
          matched_count?: number
          notes?: string | null
          partial_count?: number
          portfolio_id: string
          reviewer_id?: string | null
          started_at?: string
          unmatched_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deviated_count?: number
          holdings_upload_id?: string | null
          id?: string
          matched_count?: number
          notes?: string | null
          partial_count?: number
          portfolio_id?: string
          reviewer_id?: string | null
          started_at?: string
          unmatched_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      removal_requests: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          reason: string | null
          requested_by: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          target_user_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          reason?: string | null
          requested_by: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_user_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          reason?: string | null
          requested_by?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_user_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "removal_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      research_field_access_requests: {
        Row: {
          created_at: string | null
          id: string
          request_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          team_field_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          request_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          team_field_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          request_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          team_field_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_field_access_requests_team_field_id_fkey"
            columns: ["team_field_id"]
            isOneToOne: false
            referencedRelation: "team_research_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      research_field_viewers: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          team_field_id: string
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          team_field_id: string
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          team_field_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_field_viewers_team_field_id_fkey"
            columns: ["team_field_id"]
            isOneToOne: false
            referencedRelation: "team_research_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      research_fields: {
        Row: {
          category: string | null
          config: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          field_type: string
          id: string
          is_archived: boolean | null
          is_system: boolean | null
          is_universal: boolean | null
          name: string
          organization_id: string | null
          section_id: string | null
          slug: string
          suggested_section: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          field_type?: string
          id?: string
          is_archived?: boolean | null
          is_system?: boolean | null
          is_universal?: boolean | null
          name: string
          organization_id?: string | null
          section_id?: string | null
          slug: string
          suggested_section?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          config?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          field_type?: string
          id?: string
          is_archived?: boolean | null
          is_system?: boolean | null
          is_universal?: boolean | null
          name?: string
          organization_id?: string | null
          section_id?: string | null
          slug?: string
          suggested_section?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "research_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sections: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number
          id: string
          is_system: boolean | null
          name: string
          organization_id: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean | null
          name: string
          organization_id: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean | null
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          asset_id: string
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scenarios_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenarios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_collaborators: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          permission: Database["public"]["Enums"]["simulation_permission"]
          simulation_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: Database["public"]["Enums"]["simulation_permission"]
          simulation_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: Database["public"]["Enums"]["simulation_permission"]
          simulation_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_collaborators_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_collaborators_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_share_events: {
        Row: {
          actor_id: string
          created_at: string
          details: Json | null
          event_type: string
          id: string
          share_id: string | null
          simulation_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          share_id?: string | null
          simulation_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          share_id?: string | null
          simulation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_share_events_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "simulation_shares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_share_events_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_shares: {
        Row: {
          access_level: Database["public"]["Enums"]["simulation_share_access"]
          created_at: string
          id: string
          message: string | null
          revoked_at: string | null
          revoked_by: string | null
          share_mode: Database["public"]["Enums"]["simulation_share_mode"]
          shared_by: string
          shared_with: string
          simulation_id: string
          snapshot_id: string | null
          updated_at: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["simulation_share_access"]
          created_at?: string
          id?: string
          message?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          share_mode?: Database["public"]["Enums"]["simulation_share_mode"]
          shared_by: string
          shared_with: string
          simulation_id: string
          snapshot_id?: string | null
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["simulation_share_access"]
          created_at?: string
          id?: string
          message?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          share_mode?: Database["public"]["Enums"]["simulation_share_mode"]
          shared_by?: string
          shared_with?: string
          simulation_id?: string
          snapshot_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_shares_shared_by_public_users_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_shares_shared_with_public_users_fkey"
            columns: ["shared_with"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_shares_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_shares_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "simulation_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_snapshots: {
        Row: {
          baseline_holdings: Json | null
          baseline_total_value: number | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          result_metrics: Json | null
          snapshot_trades: Json
          snapshot_variants: Json | null
          source_simulation_id: string
          source_version: number | null
        }
        Insert: {
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          result_metrics?: Json | null
          snapshot_trades?: Json
          snapshot_variants?: Json | null
          source_simulation_id: string
          source_version?: number | null
        }
        Update: {
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          result_metrics?: Json | null
          snapshot_trades?: Json
          snapshot_variants?: Json | null
          source_simulation_id?: string
          source_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_snapshots_source_simulation_id_fkey"
            columns: ["source_simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_suggestions: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          notes: string | null
          portfolio_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resulting_variant_id: string | null
          share_id: string
          simulation_id: string
          sizing_input: string
          status: string
          suggested_by: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          notes?: string | null
          portfolio_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resulting_variant_id?: string | null
          share_id: string
          simulation_id: string
          sizing_input: string
          status?: string
          suggested_by: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          portfolio_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resulting_variant_id?: string | null
          share_id?: string
          simulation_id?: string
          sizing_input?: string
          status?: string
          suggested_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_suggestions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_suggestions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_suggestions_resulting_variant_id_fkey"
            columns: ["resulting_variant_id"]
            isOneToOne: false
            referencedRelation: "lab_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_suggestions_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "simulation_shares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_suggestions_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_trades: {
        Row: {
          action: Database["public"]["Enums"]["trade_action"]
          asset_id: string
          autosave_version: number
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          lab_id: string | null
          last_autosave_at: string | null
          notes: string | null
          price: number | null
          shares: number | null
          simulation_id: string
          sort_order: number | null
          tags: string[] | null
          trade_queue_item_id: string | null
          updated_at: string | null
          updated_by: string | null
          view_id: string | null
          visibility_tier: Database["public"]["Enums"]["visibility_tier"]
          weight: number | null
        }
        Insert: {
          action?: Database["public"]["Enums"]["trade_action"]
          asset_id: string
          autosave_version?: number
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          lab_id?: string | null
          last_autosave_at?: string | null
          notes?: string | null
          price?: number | null
          shares?: number | null
          simulation_id: string
          sort_order?: number | null
          tags?: string[] | null
          trade_queue_item_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          view_id?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
          weight?: number | null
        }
        Update: {
          action?: Database["public"]["Enums"]["trade_action"]
          asset_id?: string
          autosave_version?: number
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          lab_id?: string | null
          last_autosave_at?: string | null
          notes?: string | null
          price?: number | null
          shares?: number | null
          simulation_id?: string
          sort_order?: number | null
          tags?: string[] | null
          trade_queue_item_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          view_id?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_trades_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          baseline_holdings: Json | null
          baseline_total_value: number | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_collaborative: boolean | null
          name: string
          portfolio_id: string
          result_metrics: Json | null
          status: Database["public"]["Enums"]["simulation_status"]
          updated_at: string | null
          view_id: string | null
          visibility: string | null
        }
        Insert: {
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_collaborative?: boolean | null
          name: string
          portfolio_id: string
          result_metrics?: Json | null
          status?: Database["public"]["Enums"]["simulation_status"]
          updated_at?: string | null
          view_id?: string | null
          visibility?: string | null
        }
        Update: {
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_collaborative?: boolean | null
          name?: string
          portfolio_id?: string
          result_metrics?: Json | null
          status?: Database["public"]["Enums"]["simulation_status"]
          updated_at?: string | null
          view_id?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulations_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulations_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_assignments: {
        Row: {
          asset_id: string
          assigned_at: string | null
          assigned_by: string
          assigned_user_id: string
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          stage_id: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          asset_id: string
          assigned_at?: string | null
          assigned_by: string
          assigned_user_id: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          stage_id: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          asset_id?: string
          assigned_at?: string | null
          assigned_by?: string
          assigned_user_id?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          stage_id?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_assignments_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_assignments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_assignments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      table_column_content_sources: {
        Row: {
          column_id: string
          created_at: string | null
          id: string
          list_id: string | null
          source_type: string
          source_user_ids: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          column_id: string
          created_at?: string | null
          id?: string
          list_id?: string | null
          source_type: string
          source_user_ids?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          column_id?: string
          created_at?: string | null
          id?: string
          list_id?: string | null
          source_type?: string
          source_user_ids?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_column_content_sources_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      target_date_funds: {
        Row: {
          benchmark: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          fund_code: string | null
          id: string
          inception_date: string | null
          is_active: boolean | null
          name: string
          organization_id: string
          target_year: number
          updated_at: string | null
        }
        Insert: {
          benchmark?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          fund_code?: string | null
          id?: string
          inception_date?: string | null
          is_active?: boolean | null
          name: string
          organization_id: string
          target_year: number
          updated_at?: string | null
        }
        Update: {
          benchmark?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          fund_code?: string | null
          id?: string
          inception_date?: string | null
          is_active?: boolean | null
          name?: string
          organization_id?: string
          target_year?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "target_date_funds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "target_date_funds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          reply_to: string | null
          tdf_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          reply_to?: string | null
          tdf_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          reply_to?: string | null
          tdf_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tdf_comments_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "tdf_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_comments_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_executed_trades: {
        Row: {
          action: string
          created_at: string | null
          executed_by: string | null
          execution_notes: string | null
          id: string
          price: number
          proposal_id: string | null
          rationale: string | null
          shares: number
          tdf_id: string
          total_value: number
          trade_date: string
          underlying_fund_id: string
          weight_after: number | null
          weight_before: number | null
        }
        Insert: {
          action: string
          created_at?: string | null
          executed_by?: string | null
          execution_notes?: string | null
          id?: string
          price: number
          proposal_id?: string | null
          rationale?: string | null
          shares: number
          tdf_id: string
          total_value: number
          trade_date: string
          underlying_fund_id: string
          weight_after?: number | null
          weight_before?: number | null
        }
        Update: {
          action?: string
          created_at?: string | null
          executed_by?: string | null
          execution_notes?: string | null
          id?: string
          price?: number
          proposal_id?: string | null
          rationale?: string | null
          shares?: number
          tdf_id?: string
          total_value?: number
          trade_date?: string
          underlying_fund_id?: string
          weight_after?: number | null
          weight_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tdf_executed_trades_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_executed_trades_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "tdf_trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_executed_trades_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_executed_trades_underlying_fund_id_fkey"
            columns: ["underlying_fund_id"]
            isOneToOne: false
            referencedRelation: "tdf_underlying_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_glide_path_targets: {
        Row: {
          alternatives_weight: number | null
          cash_weight: number | null
          created_at: string | null
          effective_date: string | null
          equity_weight: number
          fixed_income_weight: number
          id: string
          tdf_id: string
          updated_at: string | null
          years_to_retirement: number
        }
        Insert: {
          alternatives_weight?: number | null
          cash_weight?: number | null
          created_at?: string | null
          effective_date?: string | null
          equity_weight: number
          fixed_income_weight: number
          id?: string
          tdf_id: string
          updated_at?: string | null
          years_to_retirement: number
        }
        Update: {
          alternatives_weight?: number | null
          cash_weight?: number | null
          created_at?: string | null
          effective_date?: string | null
          equity_weight?: number
          fixed_income_weight?: number
          id?: string
          tdf_id?: string
          updated_at?: string | null
          years_to_retirement?: number
        }
        Relationships: [
          {
            foreignKeyName: "tdf_glide_path_targets_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_holdings: {
        Row: {
          created_at: string | null
          id: string
          market_value: number | null
          shares: number | null
          snapshot_id: string
          underlying_fund_id: string
          weight: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          market_value?: number | null
          shares?: number | null
          snapshot_id: string
          underlying_fund_id: string
          weight: number
        }
        Update: {
          created_at?: string | null
          id?: string
          market_value?: number | null
          shares?: number | null
          snapshot_id?: string
          underlying_fund_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "tdf_holdings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "tdf_holdings_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_holdings_underlying_fund_id_fkey"
            columns: ["underlying_fund_id"]
            isOneToOne: false
            referencedRelation: "tdf_underlying_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_holdings_snapshots: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          snapshot_date: string
          snapshot_type: string | null
          tdf_id: string
          total_aum: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          snapshot_date: string
          snapshot_type?: string | null
          tdf_id: string
          total_aum?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          snapshot_date?: string
          snapshot_type?: string | null
          tdf_id?: string
          total_aum?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tdf_holdings_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_holdings_snapshots_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_notes: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          is_pinned: boolean | null
          note_type: string | null
          tdf_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          note_type?: string | null
          tdf_id: string
          title?: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_pinned?: boolean | null
          note_type?: string | null
          tdf_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tdf_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_notes_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_trade_proposal_items: {
        Row: {
          action: string
          created_at: string | null
          current_weight: number | null
          estimated_shares: number | null
          estimated_value: number | null
          id: string
          proposal_id: string
          target_weight: number | null
          underlying_fund_id: string
          weight_change: number | null
        }
        Insert: {
          action: string
          created_at?: string | null
          current_weight?: number | null
          estimated_shares?: number | null
          estimated_value?: number | null
          id?: string
          proposal_id: string
          target_weight?: number | null
          underlying_fund_id: string
          weight_change?: number | null
        }
        Update: {
          action?: string
          created_at?: string | null
          current_weight?: number | null
          estimated_shares?: number | null
          estimated_value?: number | null
          id?: string
          proposal_id?: string
          target_weight?: number | null
          underlying_fund_id?: string
          weight_change?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tdf_trade_proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "tdf_trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_trade_proposal_items_underlying_fund_id_fkey"
            columns: ["underlying_fund_id"]
            isOneToOne: false
            referencedRelation: "tdf_underlying_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_trade_proposals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          description: string | null
          id: string
          proposed_by: string | null
          rationale: string
          status: Database["public"]["Enums"]["tdf_trade_status"] | null
          tdf_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          proposed_by?: string | null
          rationale: string
          status?: Database["public"]["Enums"]["tdf_trade_status"] | null
          tdf_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          proposed_by?: string | null
          rationale?: string
          status?: Database["public"]["Enums"]["tdf_trade_status"] | null
          tdf_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tdf_trade_proposals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_trade_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tdf_trade_proposals_tdf_id_fkey"
            columns: ["tdf_id"]
            isOneToOne: false
            referencedRelation: "target_date_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      tdf_underlying_funds: {
        Row: {
          asset_class: string | null
          created_at: string | null
          expense_ratio: number | null
          id: string
          is_active: boolean | null
          name: string
          sub_asset_class: string | null
          ticker: string | null
          updated_at: string | null
        }
        Insert: {
          asset_class?: string | null
          created_at?: string | null
          expense_ratio?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          sub_asset_class?: string | null
          ticker?: string | null
          updated_at?: string | null
        }
        Update: {
          asset_class?: string | null
          created_at?: string | null
          expense_ratio?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          sub_asset_class?: string | null
          ticker?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      team_access_requests: {
        Row: {
          created_at: string | null
          id: string
          reason: string | null
          request_type: string
          requested_role: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          target_id: string
          target_name: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          reason?: string | null
          request_type: string
          requested_role?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_id: string
          target_name?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          reason?: string | null
          request_type?: string
          requested_role?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          target_id?: string
          target_name?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_access_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          created_at: string | null
          id: string
          is_team_admin: boolean | null
          joined_at: string | null
          role_id: string | null
          team_id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_team_admin?: boolean | null
          joined_at?: string | null
          role_id?: string | null
          team_id: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_team_admin?: boolean | null
          joined_at?: string | null
          role_id?: string | null
          team_id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "user_role_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_research_fields: {
        Row: {
          created_at: string | null
          display_order: number
          field_id: string
          id: string
          is_active: boolean | null
          is_required: boolean | null
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number
          field_id: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number
          field_id?: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_research_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "research_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_research_fields_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          org_chart_node_id: string | null
          organization_id: string
          settings: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_chart_node_id?: string | null
          organization_id: string
          settings?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_chart_node_id?: string | null
          organization_id?: string
          settings?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_chart_node_id_fkey"
            columns: ["org_chart_node_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_org_chart_node_id_fkey"
            columns: ["org_chart_node_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          permission: string
          team_id: string | null
          template_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string
          team_id?: string | null
          template_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string
          team_id?: string | null
          template_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "template_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_collaborations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_collaborations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "text_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      template_tag_assignments: {
        Row: {
          tag_id: string
          template_id: string
        }
        Insert: {
          tag_id: string
          template_id: string
        }
        Update: {
          tag_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "template_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_tag_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "text_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      template_tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      text_templates: {
        Row: {
          category: string | null
          content: string
          content_html: string | null
          created_at: string | null
          description: string | null
          id: string
          is_favorite: boolean | null
          is_shared: boolean | null
          last_used_at: string | null
          name: string
          organization_id: string
          shortcut: string | null
          updated_at: string | null
          usage_count: number | null
          user_id: string
          variables: Json | null
        }
        Insert: {
          category?: string | null
          content: string
          content_html?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          is_shared?: boolean | null
          last_used_at?: string | null
          name: string
          organization_id: string
          shortcut?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id: string
          variables?: Json | null
        }
        Update: {
          category?: string | null
          content?: string
          content_html?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_favorite?: boolean | null
          is_shared?: boolean | null
          last_used_at?: string | null
          name?: string
          organization_id?: string
          shortcut?: string | null
          updated_at?: string | null
          usage_count?: number | null
          user_id?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "text_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "text_templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_activity: {
        Row: {
          activity_type: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          theme_id: string
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          theme_id: string
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_activity_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_activity_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_assets: {
        Row: {
          added_at: string | null
          added_by: string | null
          asset_id: string
          created_at: string | null
          id: string
          notes: string | null
          theme_id: string
          updated_at: string | null
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          asset_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          theme_id: string
          updated_at?: string | null
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          asset_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          theme_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "theme_assets_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_assets_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_assets_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          permission: string
          theme_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string
          theme_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string
          theme_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_collaborations_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_collaborations_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_contribution_history: {
        Row: {
          changed_at: string
          changed_by: string
          contribution_id: string
          id: string
          new_content: string
          new_supporting_detail: string | null
          old_content: string | null
          old_supporting_detail: string | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          contribution_id: string
          id?: string
          new_content: string
          new_supporting_detail?: string | null
          old_content?: string | null
          old_supporting_detail?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          contribution_id?: string
          id?: string
          new_content?: string
          new_supporting_detail?: string | null
          old_content?: string | null
          old_supporting_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "theme_contribution_history_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "theme_contributions_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_contributions: {
        Row: {
          created_at: string
          id: string
          risks: string
          theme_id: string
          thesis: string
          updated_at: string
          user_id: string
          where_different: string
        }
        Insert: {
          created_at?: string
          id?: string
          risks?: string
          theme_id: string
          thesis?: string
          updated_at?: string
          user_id: string
          where_different?: string
        }
        Update: {
          created_at?: string
          id?: string
          risks?: string
          theme_id?: string
          thesis?: string
          updated_at?: string
          user_id?: string
          where_different?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_contributions_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_contributions_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_contributions_v2: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          attachments: Json
          content: string
          created_at: string
          created_by: string
          draft_content: string | null
          draft_updated_at: string | null
          id: string
          is_archived: boolean
          is_pinned: boolean
          organization_id: string
          pinned_at: string | null
          pinned_by: string | null
          section: string
          sort_order: number
          supporting_detail: string | null
          theme_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          attachments?: Json
          content?: string
          created_at?: string
          created_by: string
          draft_content?: string | null
          draft_updated_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id: string
          pinned_at?: string | null
          pinned_by?: string | null
          section: string
          sort_order?: number
          supporting_detail?: string | null
          theme_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          attachments?: Json
          content?: string
          created_at?: string
          created_by?: string
          draft_content?: string | null
          draft_updated_at?: string | null
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          organization_id?: string
          pinned_at?: string | null
          pinned_by?: string | null
          section?: string
          sort_order?: number
          supporting_detail?: string | null
          theme_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_contributions_v2_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_contributions_v2_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_discussions: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          is_deleted: boolean
          is_edited: boolean
          organization_id: string
          theme_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          organization_id: string
          theme_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          organization_id?: string
          theme_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_discussions_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_discussions_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_key_references: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          display_order: number | null
          external_provider: string | null
          external_url: string | null
          id: string
          importance: string
          is_pinned: boolean
          organization_id: string
          reference_type: string
          target_id: string | null
          target_table: string | null
          theme_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          external_provider?: string | null
          external_url?: string | null
          id?: string
          importance?: string
          is_pinned?: boolean
          organization_id: string
          reference_type: string
          target_id?: string | null
          target_table?: string | null
          theme_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          external_provider?: string | null
          external_url?: string | null
          id?: string
          importance?: string
          is_pinned?: boolean
          organization_id?: string
          reference_type?: string
          target_id?: string | null
          target_table?: string | null
          theme_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_key_references_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_key_references_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_notes: {
        Row: {
          content: string
          content_preview: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_deleted: boolean
          is_shared: boolean | null
          metadata: Json | null
          note_type: Database["public"]["Enums"]["note_type"] | null
          organization_id: string | null
          theme_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          theme_id: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          content?: string
          content_preview?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          is_shared?: boolean | null
          metadata?: Json | null
          note_type?: Database["public"]["Enums"]["note_type"] | null
          organization_id?: string | null
          theme_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "theme_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_notes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_notes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_research_fields: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          field_type: string
          id: string
          is_archived: boolean
          is_system: boolean
          is_universal: boolean
          name: string
          organization_id: string
          placeholder: string | null
          section_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          field_type?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          is_universal?: boolean
          name: string
          organization_id: string
          placeholder?: string | null
          section_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          field_type?: string
          id?: string
          is_archived?: boolean
          is_system?: boolean
          is_universal?: boolean
          name?: string
          organization_id?: string
          placeholder?: string | null
          section_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_research_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "theme_research_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_research_sections: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_system: boolean
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      theme_workflow_progress: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          current_stage_key: string | null
          id: string
          is_completed: boolean
          is_started: boolean
          started_at: string | null
          started_by: string | null
          theme_id: string
          updated_at: string
          updated_by: string | null
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean
          is_started?: boolean
          started_at?: string | null
          started_by?: string | null
          theme_id: string
          updated_at?: string
          updated_by?: string | null
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          current_stage_key?: string | null
          id?: string
          is_completed?: boolean
          is_started?: boolean
          started_at?: string | null
          started_by?: string | null
          theme_id?: string
          updated_at?: string
          updated_by?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_workflow_progress_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "org_themes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_workflow_progress_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theme_workflow_progress_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          is_public: boolean | null
          lifecycle_status: Database["public"]["Enums"]["theme_lifecycle_status"]
          name: string
          organization_id: string
          theme_type: Database["public"]["Enums"]["theme_type"] | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_public?: boolean | null
          lifecycle_status?: Database["public"]["Enums"]["theme_lifecycle_status"]
          name: string
          organization_id: string
          theme_type?: Database["public"]["Enums"]["theme_type"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_public?: boolean | null
          lifecycle_status?: Database["public"]["Enums"]["theme_lifecycle_status"]
          name?: string
          organization_id?: string
          theme_type?: Database["public"]["Enums"]["theme_type"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "themes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "themes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      thought_reactions: {
        Row: {
          created_at: string | null
          id: string
          reaction_type: string
          thought_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          reaction_type: string
          thought_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          reaction_type?: string
          thought_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thought_reactions_thought_id_fkey"
            columns: ["thought_id"]
            isOneToOne: false
            referencedRelation: "quick_thoughts"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          name: string
          organization_id: string
          slug: string | null
          updated_at: string | null
          visibility: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          name: string
          organization_id: string
          slug?: string | null
          updated_at?: string | null
          visibility?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          name?: string
          organization_id?: string
          slug?: string | null
          updated_at?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_batches: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          metadata: Json | null
          name: string | null
          portfolio_id: string
          snapshot: Json | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          portfolio_id: string
          snapshot?: Json | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          portfolio_id?: string
          snapshot?: Json | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_batches_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_event_rationales: {
        Row: {
          authored_at: string
          authored_by: string | null
          catalyst_trigger: string | null
          created_at: string
          divergence_explanation: string | null
          divergence_from_plan: boolean | null
          execution_context: string | null
          id: string
          linked_object_refs: Json | null
          rationale_type: Database["public"]["Enums"]["rationale_type"]
          reason_for_action: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_context: string | null
          sizing_logic: string | null
          status: Database["public"]["Enums"]["rationale_status"]
          thesis_context: string | null
          trade_event_id: string
          updated_at: string
          version_number: number
          what_changed: string | null
          why_now: string | null
        }
        Insert: {
          authored_at?: string
          authored_by?: string | null
          catalyst_trigger?: string | null
          created_at?: string
          divergence_explanation?: string | null
          divergence_from_plan?: boolean | null
          execution_context?: string | null
          id?: string
          linked_object_refs?: Json | null
          rationale_type?: Database["public"]["Enums"]["rationale_type"]
          reason_for_action?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_context?: string | null
          sizing_logic?: string | null
          status?: Database["public"]["Enums"]["rationale_status"]
          thesis_context?: string | null
          trade_event_id: string
          updated_at?: string
          version_number?: number
          what_changed?: string | null
          why_now?: string | null
        }
        Update: {
          authored_at?: string
          authored_by?: string | null
          catalyst_trigger?: string | null
          created_at?: string
          divergence_explanation?: string | null
          divergence_from_plan?: boolean | null
          execution_context?: string | null
          id?: string
          linked_object_refs?: Json | null
          rationale_type?: Database["public"]["Enums"]["rationale_type"]
          reason_for_action?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_context?: string | null
          sizing_logic?: string | null
          status?: Database["public"]["Enums"]["rationale_status"]
          thesis_context?: string | null
          trade_event_id?: string
          updated_at?: string
          version_number?: number
          what_changed?: string | null
          why_now?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_event_rationales_trade_event_id_fkey"
            columns: ["trade_event_id"]
            isOneToOne: false
            referencedRelation: "portfolio_trade_events"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["trade_event_type"]
          id: string
          metadata: Json
          proposal_id: string | null
          proposal_version_id: string | null
          trade_queue_item_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["trade_event_type"]
          id?: string
          metadata?: Json
          proposal_id?: string | null
          proposal_version_id?: string | null
          trade_queue_item_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["trade_event_type"]
          id?: string
          metadata?: Json
          proposal_id?: string | null
          proposal_version_id?: string | null
          trade_queue_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_events_proposal_version_id_fkey"
            columns: ["proposal_version_id"]
            isOneToOne: false
            referencedRelation: "trade_proposal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_events_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_idea_portfolios: {
        Row: {
          accepted_shares: number | null
          accepted_weight: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_outcome:
            | Database["public"]["Enums"]["portfolio_decision_outcome"]
            | null
          decision_reason: string | null
          deferred_until: string | null
          id: string
          portfolio_id: string
          stage: Database["public"]["Enums"]["trade_stage"]
          trade_queue_item_id: string
          updated_at: string
        }
        Insert: {
          accepted_shares?: number | null
          accepted_weight?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?:
            | Database["public"]["Enums"]["portfolio_decision_outcome"]
            | null
          decision_reason?: string | null
          deferred_until?: string | null
          id?: string
          portfolio_id: string
          stage?: Database["public"]["Enums"]["trade_stage"]
          trade_queue_item_id: string
          updated_at?: string
        }
        Update: {
          accepted_shares?: number | null
          accepted_weight?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?:
            | Database["public"]["Enums"]["portfolio_decision_outcome"]
            | null
          decision_reason?: string | null
          deferred_until?: string | null
          id?: string
          portfolio_id?: string
          stage?: Database["public"]["Enums"]["trade_stage"]
          trade_queue_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_idea_portfolios_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_portfolios_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_portfolios_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_idea_theses: {
        Row: {
          conviction: string | null
          created_at: string
          created_by: string
          direction: string
          id: string
          portfolio_id: string | null
          rationale: string
          trade_queue_item_id: string
          updated_at: string
        }
        Insert: {
          conviction?: string | null
          created_at?: string
          created_by: string
          direction: string
          id?: string
          portfolio_id?: string | null
          rationale: string
          trade_queue_item_id: string
          updated_at?: string
        }
        Update: {
          conviction?: string | null
          created_at?: string
          created_by?: string
          direction?: string
          id?: string
          portfolio_id?: string | null
          rationale?: string
          trade_queue_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_idea_theses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_theses_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_theses_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_idea_topics: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          topic_id: string
          trade_queue_item_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          topic_id: string
          trade_queue_item_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          topic_id?: string
          trade_queue_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_idea_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "org_topics_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_idea_topics_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_lab_idea_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          proposed_shares: number | null
          proposed_weight: number | null
          trade_lab_id: string
          trade_queue_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          proposed_shares?: number | null
          proposed_weight?: number | null
          trade_lab_id: string
          trade_queue_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          proposed_shares?: number | null
          proposed_weight?: number | null
          trade_lab_id?: string
          trade_queue_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_lab_idea_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_idea_links_trade_lab_id_fkey"
            columns: ["trade_lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_idea_links_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_lab_simulation_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          included: boolean
          trade_queue_item_id: string
          updated_at: string
          view_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          included?: boolean
          trade_queue_item_id: string
          updated_at?: string
          view_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          included?: boolean
          trade_queue_item_id?: string
          updated_at?: string
          view_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_lab_simulation_items_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_simulation_items_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_lab_view_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["trade_lab_view_role"]
          updated_at: string
          user_id: string
          view_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["trade_lab_view_role"]
          updated_at?: string
          user_id: string
          view_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["trade_lab_view_role"]
          updated_at?: string
          user_id?: string
          view_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_lab_view_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_view_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_view_members_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "trade_lab_views"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_lab_views: {
        Row: {
          archived_at: string | null
          baseline_captured_at: string | null
          baseline_holdings: Json | null
          baseline_total_value: number | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          lab_id: string | null
          name: string
          owner_id: string | null
          updated_at: string
          view_type: Database["public"]["Enums"]["trade_lab_view_type"]
          visibility_tier: Database["public"]["Enums"]["visibility_tier"]
        }
        Insert: {
          archived_at?: string | null
          baseline_captured_at?: string | null
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          lab_id?: string | null
          name: string
          owner_id?: string | null
          updated_at?: string
          view_type?: Database["public"]["Enums"]["trade_lab_view_type"]
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Update: {
          archived_at?: string | null
          baseline_captured_at?: string | null
          baseline_holdings?: Json | null
          baseline_total_value?: number | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          lab_id?: string | null
          name?: string
          owner_id?: string | null
          updated_at?: string
          view_type?: Database["public"]["Enums"]["trade_lab_view_type"]
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "trade_lab_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_views_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_views_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_lab_views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_labs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          legacy_simulation_id: string | null
          name: string
          portfolio_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          legacy_simulation_id?: string | null
          name?: string
          portfolio_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          legacy_simulation_id?: string | null
          name?: string
          portfolio_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_labs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_labs_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: true
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_proposal_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          portfolio_id: string | null
          proposal_id: string
          shares: number | null
          sizing_context: Json | null
          sizing_mode: string | null
          trigger_event: string | null
          version_number: number
          weight: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          portfolio_id?: string | null
          proposal_id: string
          shares?: number | null
          sizing_context?: Json | null
          sizing_mode?: string | null
          trigger_event?: string | null
          version_number?: number
          weight?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          portfolio_id?: string | null
          proposal_id?: string
          shares?: number | null
          sizing_context?: Json | null
          sizing_mode?: string | null
          trigger_event?: string | null
          version_number?: number
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_proposal_versions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposal_versions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "trade_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_proposals: {
        Row: {
          analyst_input_requested: boolean | null
          analyst_input_requested_at: string | null
          created_at: string
          id: string
          is_active: boolean
          lab_id: string | null
          notes: string | null
          portfolio_id: string
          proposal_type: string | null
          shares: number | null
          sizing_context: Json | null
          sizing_mode: string | null
          trade_queue_item_id: string
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          analyst_input_requested?: boolean | null
          analyst_input_requested_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lab_id?: string | null
          notes?: string | null
          portfolio_id: string
          proposal_type?: string | null
          shares?: number | null
          sizing_context?: Json | null
          sizing_mode?: string | null
          trade_queue_item_id: string
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          analyst_input_requested?: boolean | null
          analyst_input_requested_at?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lab_id?: string | null
          notes?: string | null
          portfolio_id?: string
          proposal_type?: string | null
          shares?: number | null
          sizing_context?: Json | null
          sizing_mode?: string | null
          trade_queue_item_id?: string
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_proposals_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_proposals_user_id_public_users_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_queue_comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_edited: boolean | null
          suggested_shares: number | null
          suggested_weight: number | null
          trade_queue_item_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          suggested_shares?: number | null
          suggested_weight?: number | null
          trade_queue_item_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_edited?: boolean | null
          suggested_shares?: number | null
          suggested_weight?: number | null
          trade_queue_item_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_queue_comments_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_queue_items: {
        Row: {
          action: Database["public"]["Enums"]["trade_action"]
          alert_at: string | null
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          asset_id: string
          assigned_to: string | null
          catalyst_clarity: number | null
          collaborators: Json | null
          context_tags: Json
          conviction: string | null
          created_at: string | null
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_outcome: string | null
          decision_reason: string | null
          deferred_until: string | null
          deleted_at: string | null
          deleted_by: string | null
          executed_at: string | null
          expires_at: string | null
          id: string
          organization_id: string | null
          origin_entity_id: string | null
          origin_entity_type:
            | Database["public"]["Enums"]["origin_entity_type"]
            | null
          origin_metadata: Json
          origin_route: string | null
          origin_type: Database["public"]["Enums"]["origin_type"]
          outcome: Database["public"]["Enums"]["trade_outcome"] | null
          outcome_at: string | null
          outcome_by: string | null
          outcome_note: string | null
          pair_id: string | null
          pair_leg_type: string | null
          pair_trade_id: string | null
          portfolio_id: string | null
          previous_state: Json | null
          priority: number | null
          proposed_shares: number | null
          proposed_weight: number | null
          rationale: string | null
          research_depth: number | null
          revisit_at: string | null
          sharing_visibility: string | null
          stage: Database["public"]["Enums"]["trade_stage"]
          stage_changed_at: string | null
          status: Database["public"]["Enums"]["trade_queue_status"]
          stop_loss: number | null
          take_profit: number | null
          target_price: number | null
          thesis_text: string | null
          time_horizon: string | null
          updated_at: string | null
          urgency: string | null
          visibility_tier: Database["public"]["Enums"]["visibility_tier"]
        }
        Insert: {
          action?: Database["public"]["Enums"]["trade_action"]
          alert_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          asset_id: string
          assigned_to?: string | null
          catalyst_clarity?: number | null
          collaborators?: Json | null
          context_tags?: Json
          conviction?: string | null
          created_at?: string | null
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?: string | null
          decision_reason?: string | null
          deferred_until?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          executed_at?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          origin_entity_id?: string | null
          origin_entity_type?:
            | Database["public"]["Enums"]["origin_entity_type"]
            | null
          origin_metadata?: Json
          origin_route?: string | null
          origin_type?: Database["public"]["Enums"]["origin_type"]
          outcome?: Database["public"]["Enums"]["trade_outcome"] | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_note?: string | null
          pair_id?: string | null
          pair_leg_type?: string | null
          pair_trade_id?: string | null
          portfolio_id?: string | null
          previous_state?: Json | null
          priority?: number | null
          proposed_shares?: number | null
          proposed_weight?: number | null
          rationale?: string | null
          research_depth?: number | null
          revisit_at?: string | null
          sharing_visibility?: string | null
          stage: Database["public"]["Enums"]["trade_stage"]
          stage_changed_at?: string | null
          status?: Database["public"]["Enums"]["trade_queue_status"]
          stop_loss?: number | null
          take_profit?: number | null
          target_price?: number | null
          thesis_text?: string | null
          time_horizon?: string | null
          updated_at?: string | null
          urgency?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Update: {
          action?: Database["public"]["Enums"]["trade_action"]
          alert_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          asset_id?: string
          assigned_to?: string | null
          catalyst_clarity?: number | null
          collaborators?: Json | null
          context_tags?: Json
          conviction?: string | null
          created_at?: string | null
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?: string | null
          decision_reason?: string | null
          deferred_until?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          executed_at?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string | null
          origin_entity_id?: string | null
          origin_entity_type?:
            | Database["public"]["Enums"]["origin_entity_type"]
            | null
          origin_metadata?: Json
          origin_route?: string | null
          origin_type?: Database["public"]["Enums"]["origin_type"]
          outcome?: Database["public"]["Enums"]["trade_outcome"] | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_note?: string | null
          pair_id?: string | null
          pair_leg_type?: string | null
          pair_trade_id?: string | null
          portfolio_id?: string | null
          previous_state?: Json | null
          priority?: number | null
          proposed_shares?: number | null
          proposed_weight?: number | null
          rationale?: string | null
          research_depth?: number | null
          revisit_at?: string | null
          sharing_visibility?: string | null
          stage?: Database["public"]["Enums"]["trade_stage"]
          stage_changed_at?: string | null
          status?: Database["public"]["Enums"]["trade_queue_status"]
          stop_loss?: number | null
          take_profit?: number | null
          target_price?: number | null
          thesis_text?: string | null
          time_horizon?: string | null
          updated_at?: string | null
          urgency?: string | null
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "trade_queue_items_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_outcome_by_fkey"
            columns: ["outcome_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_pair_trade_id_fkey"
            columns: ["pair_trade_id"]
            isOneToOne: false
            referencedRelation: "pair_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_items_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_queue_votes: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string
          trade_queue_item_id: string
          user_id: string
          vote: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: string
          trade_queue_item_id: string
          user_id: string
          vote: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: string
          trade_queue_item_id?: string
          user_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_queue_votes_trade_queue_item_id_fkey"
            columns: ["trade_queue_item_id"]
            isOneToOne: false
            referencedRelation: "trade_queue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_queue_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_reconciliations: {
        Row: {
          accepted_trade_id: string
          actual_shares: number
          asset_id: string
          computed_at: string
          delta_shares: number
          deviation_pct: number | null
          expected_shares: number
          id: string
          notes: string | null
          organization_id: string | null
          portfolio_id: string
          previous_shares: number | null
          previous_snapshot_id: string | null
          snapshot_id: string
          status: string
        }
        Insert: {
          accepted_trade_id: string
          actual_shares: number
          asset_id: string
          computed_at?: string
          delta_shares: number
          deviation_pct?: number | null
          expected_shares: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          portfolio_id: string
          previous_shares?: number | null
          previous_snapshot_id?: string | null
          snapshot_id: string
          status: string
        }
        Update: {
          accepted_trade_id?: string
          actual_shares?: number
          asset_id?: string
          computed_at?: string
          delta_shares?: number
          deviation_pct?: number | null
          expected_shares?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          portfolio_id?: string
          previous_shares?: number | null
          previous_snapshot_id?: string | null
          snapshot_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_reconciliations_accepted_trade_id_fkey"
            columns: ["accepted_trade_id"]
            isOneToOne: false
            referencedRelation: "accepted_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reconciliations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reconciliations_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reconciliations_previous_snapshot_id_fkey"
            columns: ["previous_snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_holdings_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reconciliations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "portfolio_holdings_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_sheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          committed_at: string | null
          committed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          executed_at: string | null
          had_below_lot_warnings: boolean
          had_conflicts: boolean
          id: string
          lab_id: string
          name: string
          net_weight_change: number
          portfolio_id: string
          status: Database["public"]["Enums"]["trade_sheet_status"]
          submitted_at: string | null
          submitted_by: string | null
          total_notional: number
          total_trades: number
          variants_snapshot: Json
          visibility_tier: Database["public"]["Enums"]["visibility_tier"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          executed_at?: string | null
          had_below_lot_warnings?: boolean
          had_conflicts?: boolean
          id?: string
          lab_id: string
          name: string
          net_weight_change?: number
          portfolio_id: string
          status?: Database["public"]["Enums"]["trade_sheet_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          total_notional?: number
          total_trades?: number
          variants_snapshot: Json
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          executed_at?: string | null
          had_below_lot_warnings?: boolean
          had_conflicts?: boolean
          id?: string
          lab_id?: string
          name?: string
          net_weight_change?: number
          portfolio_id?: string
          status?: Database["public"]["Enums"]["trade_sheet_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          total_notional?: number
          total_trades?: number
          variants_snapshot?: Json
          visibility_tier?: Database["public"]["Enums"]["visibility_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "trade_sheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_sheets_committed_by_fkey"
            columns: ["committed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_sheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_sheets_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "trade_labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_sheets_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_sheets_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_actions: {
        Row: {
          changed_at: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          record_id: string
          table_name: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          changed_at?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id: string
          table_name: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          changed_at?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id?: string
          table_name?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_ai_column_selections: {
        Row: {
          column_id: string
          created_at: string | null
          display_order: number | null
          id: string
          is_visible: boolean | null
          list_id: string | null
          user_id: string
          width: number | null
        }
        Insert: {
          column_id: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_visible?: boolean | null
          list_id?: string | null
          user_id: string
          width?: number | null
        }
        Update: {
          column_id?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_visible?: boolean | null
          list_id?: string | null
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_ai_column_selections_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "ai_column_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_ai_column_selections_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "asset_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_config: {
        Row: {
          created_at: string | null
          daily_request_limit_override: number | null
          daily_token_limit_override: number | null
          id: string
          include_discussions: boolean | null
          include_notes: boolean | null
          include_outcomes: boolean | null
          include_price_history: boolean | null
          include_thesis: boolean | null
          last_used_at: string | null
          monthly_budget_usd_override: number | null
          preferred_model: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          daily_request_limit_override?: number | null
          daily_token_limit_override?: number | null
          id?: string
          include_discussions?: boolean | null
          include_notes?: boolean | null
          include_outcomes?: boolean | null
          include_price_history?: boolean | null
          include_thesis?: boolean | null
          last_used_at?: string | null
          monthly_budget_usd_override?: number | null
          preferred_model?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          daily_request_limit_override?: number | null
          daily_token_limit_override?: number | null
          id?: string
          include_discussions?: boolean | null
          include_notes?: boolean | null
          include_outcomes?: boolean | null
          include_price_history?: boolean | null
          include_thesis?: boolean | null
          last_used_at?: string | null
          monthly_budget_usd_override?: number | null
          preferred_model?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_asset_flags: {
        Row: {
          asset_id: string
          color: string
          created_at: string | null
          id: string
          label: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          color?: string
          created_at?: string | null
          id?: string
          label?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          color?: string
          created_at?: string | null
          id?: string
          label?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_flags_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_layout_selections: {
        Row: {
          asset_id: string
          created_at: string | null
          field_overrides: Json | null
          id: string
          layout_id: string | null
          section_overrides: Json | null
          updated_at: string | null
          user_id: string
          version: number
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          field_overrides?: Json | null
          id?: string
          layout_id?: string | null
          section_overrides?: Json | null
          updated_at?: string | null
          user_id: string
          version?: number
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          field_overrides?: Json | null
          id?: string
          layout_id?: string | null
          section_overrides?: Json | null
          updated_at?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_layout_selections_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_asset_layout_selections_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "user_asset_page_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_page_layouts: {
        Row: {
          created_at: string
          description: string | null
          field_config: Json
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          field_config?: Json
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          field_config?: Json
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_asset_page_preferences: {
        Row: {
          created_at: string
          display_order: number | null
          field_id: string
          id: string
          is_collapsed: boolean
          is_visible: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          field_id: string
          id?: string
          is_collapsed?: boolean
          is_visible?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          field_id?: string
          id?: string
          is_collapsed?: boolean
          is_visible?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_page_preferences_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "research_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_priorities: {
        Row: {
          asset_id: string
          created_at: string | null
          id: string
          priority: string
          reason: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          id?: string
          priority: string
          reason?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          id?: string
          priority?: string
          reason?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_priorities_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_references: {
        Row: {
          asset_id: string
          category: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          external_provider: string | null
          external_url: string | null
          id: string
          importance: string | null
          is_pinned: boolean | null
          reference_type: string
          target_id: string | null
          target_table: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          asset_id: string
          category?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          external_provider?: string | null
          external_url?: string | null
          id?: string
          importance?: string | null
          is_pinned?: boolean | null
          reference_type: string
          target_id?: string | null
          target_table?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          asset_id?: string
          category?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          external_provider?: string | null
          external_url?: string | null
          id?: string
          importance?: string | null
          is_pinned?: boolean | null
          reference_type?: string
          target_id?: string | null
          target_table?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_references_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_asset_references_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_widget_values: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
          value: Json | null
          widget_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
          value?: Json | null
          widget_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
          value?: Json | null
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_widget_values_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "user_asset_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_asset_widgets: {
        Row: {
          asset_id: string
          config: Json | null
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_archived: boolean | null
          title: string
          updated_at: string | null
          user_id: string
          widget_type: string
        }
        Insert: {
          asset_id: string
          config?: Json | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_archived?: boolean | null
          title: string
          updated_at?: string | null
          user_id: string
          widget_type: string
        }
        Update: {
          asset_id?: string
          config?: Json | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_archived?: boolean | null
          title?: string
          updated_at?: string | null
          user_id?: string
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_asset_widgets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_onboarding_status: {
        Row: {
          completed_at: string | null
          current_step: number | null
          id: string
          last_updated_at: string | null
          skipped_steps: Json | null
          started_at: string | null
          steps_completed: Json | null
          user_id: string
          wizard_completed: boolean | null
        }
        Insert: {
          completed_at?: string | null
          current_step?: number | null
          id?: string
          last_updated_at?: string | null
          skipped_steps?: Json | null
          started_at?: string | null
          steps_completed?: Json | null
          user_id: string
          wizard_completed?: boolean | null
        }
        Update: {
          completed_at?: string | null
          current_step?: number | null
          id?: string
          last_updated_at?: string | null
          skipped_steps?: Json | null
          started_at?: string | null
          steps_completed?: Json | null
          user_id?: string
          wizard_completed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "user_onboarding_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string | null
          id: string
          preference_key: string
          preference_type: string
          preference_value: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preference_key: string
          preference_type: string
          preference_value?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preference_key?: string
          preference_type?: string
          preference_value?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_profile_extended: {
        Row: {
          asset_class_focus: Json | null
          compliance_areas: Json | null
          compliance_divisions: Json | null
          compliance_role_description: string | null
          created_at: string | null
          email_digest_frequency: string | null
          geography_focus: Json | null
          id: string
          integration_notes: string | null
          investment_focus_summary: string | null
          investment_style: Json | null
          market_cap_focus: Json | null
          market_data_provider: string | null
          market_data_provider_other: string | null
          needs_estimates: boolean | null
          needs_fundamentals: boolean | null
          needs_index_data: boolean | null
          needs_news_feeds: boolean | null
          needs_realtime_prices: boolean | null
          notification_preferences: Json | null
          ops_departments: Json | null
          ops_role_description: string | null
          ops_workflow_types: Json | null
          sector_focus: Json | null
          specific_tickers: Json | null
          strategy_description: string | null
          time_horizon: Json | null
          title: string | null
          universe_scope: string | null
          updated_at: string | null
          user_id: string
          user_type: string | null
        }
        Insert: {
          asset_class_focus?: Json | null
          compliance_areas?: Json | null
          compliance_divisions?: Json | null
          compliance_role_description?: string | null
          created_at?: string | null
          email_digest_frequency?: string | null
          geography_focus?: Json | null
          id?: string
          integration_notes?: string | null
          investment_focus_summary?: string | null
          investment_style?: Json | null
          market_cap_focus?: Json | null
          market_data_provider?: string | null
          market_data_provider_other?: string | null
          needs_estimates?: boolean | null
          needs_fundamentals?: boolean | null
          needs_index_data?: boolean | null
          needs_news_feeds?: boolean | null
          needs_realtime_prices?: boolean | null
          notification_preferences?: Json | null
          ops_departments?: Json | null
          ops_role_description?: string | null
          ops_workflow_types?: Json | null
          sector_focus?: Json | null
          specific_tickers?: Json | null
          strategy_description?: string | null
          time_horizon?: Json | null
          title?: string | null
          universe_scope?: string | null
          updated_at?: string | null
          user_id: string
          user_type?: string | null
        }
        Update: {
          asset_class_focus?: Json | null
          compliance_areas?: Json | null
          compliance_divisions?: Json | null
          compliance_role_description?: string | null
          created_at?: string | null
          email_digest_frequency?: string | null
          geography_focus?: Json | null
          id?: string
          integration_notes?: string | null
          investment_focus_summary?: string | null
          investment_style?: Json | null
          market_cap_focus?: Json | null
          market_data_provider?: string | null
          market_data_provider_other?: string | null
          needs_estimates?: boolean | null
          needs_fundamentals?: boolean | null
          needs_index_data?: boolean | null
          needs_news_feeds?: boolean | null
          needs_realtime_prices?: boolean | null
          notification_preferences?: Json | null
          ops_departments?: Json | null
          ops_role_description?: string | null
          ops_workflow_types?: Json | null
          sector_focus?: Json | null
          specific_tickers?: Json | null
          strategy_description?: string | null
          time_horizon?: Json | null
          title?: string | null
          universe_scope?: string | null
          updated_at?: string | null
          user_id?: string
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_extended_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quick_prompt_history: {
        Row: {
          created_at: string | null
          id: string
          last_used_at: string | null
          prompt: string
          used_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          prompt: string
          used_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          prompt?: string
          used_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_role_definitions: {
        Row: {
          access_level: string
          applies_to: string
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          permissions: Json | null
          sort_order: number | null
        }
        Insert: {
          access_level: string
          applies_to?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          permissions?: Json | null
          sort_order?: number | null
        }
        Update: {
          access_level?: string
          applies_to?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          permissions?: Json | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_role_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_views: {
        Row: {
          color: string | null
          config: Json
          created_at: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          config?: Json
          created_at?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          config?: Json
          created_at?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          ip_address: unknown
          is_active: boolean | null
          last_heartbeat_at: string
          organization_id: string | null
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          last_heartbeat_at?: string
          organization_id?: string | null
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          last_heartbeat_at?: string
          organization_id?: string | null
          started_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          coverage_admin: boolean | null
          created_at: string | null
          current_organization_id: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          is_pilot_user: boolean
          last_name: string | null
          pilot_progress: Json
          timezone: string | null
          updated_at: string | null
          user_type: string | null
        }
        Insert: {
          coverage_admin?: boolean | null
          created_at?: string | null
          current_organization_id?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          is_pilot_user?: boolean
          last_name?: string | null
          pilot_progress?: Json
          timezone?: string | null
          updated_at?: string | null
          user_type?: string | null
        }
        Update: {
          coverage_admin?: boolean | null
          created_at?: string | null
          current_organization_id?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_pilot_user?: boolean
          last_name?: string | null
          pilot_progress?: Json
          timezone?: string | null
          updated_at?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_current_organization_id_fkey"
            columns: ["current_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_access_requests: {
        Row: {
          created_at: string | null
          current_permission: string | null
          id: string
          reason: string
          requested_permission: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
          user_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          current_permission?: string | null
          id?: string
          reason: string
          requested_permission: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          current_permission?: string | null
          id?: string
          reason?: string
          requested_permission?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_access_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_access_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_access_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_automation_rules: {
        Row: {
          action_type: string
          action_value: Json
          condition_type: string
          condition_value: Json
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          next_run_at: string | null
          rule_category: string
          rule_name: string
          rule_type: string
          run_count: number | null
          schedule_error: string | null
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          action_type: string
          action_value?: Json
          condition_type: string
          condition_value?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          next_run_at?: string | null
          rule_category?: string
          rule_name: string
          rule_type: string
          run_count?: number | null
          schedule_error?: string | null
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          action_type?: string
          action_value?: Json
          condition_type?: string
          condition_value?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          next_run_at?: string | null
          rule_category?: string
          rule_name?: string
          rule_type?: string
          run_count?: number | null
          schedule_error?: string | null
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_automation_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_automation_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_checklist_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_required: boolean | null
          item_id: string
          item_text: string
          sort_order: number | null
          stage_id: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_required?: boolean | null
          item_id: string
          item_text: string
          sort_order?: number | null
          stage_id: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_required?: boolean | null
          item_id?: string
          item_text?: string
          sort_order?: number | null
          stage_id?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_checklist_templates_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_checklist_templates_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_collaborations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          permission: string | null
          updated_at: string | null
          user_id: string | null
          workflow_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          permission?: string | null
          updated_at?: string | null
          user_id?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_collaborations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_collaborations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_collaborations_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_collaborations_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_favorites: {
        Row: {
          created_at: string | null
          id: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          user_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_favorites_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_favorites_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_portfolio_selections: {
        Row: {
          created_at: string | null
          id: string
          portfolio_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          portfolio_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          portfolio_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_portfolio_selections_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_portfolio_selections_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_portfolio_selections_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_rule_executions: {
        Row: {
          error_message: string | null
          executed_at: string
          executed_by: string | null
          id: string
          idempotency_key: string | null
          result_summary: Json | null
          rule_id: string
          status: string
          trigger_source: string
          workflow_id: string
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          idempotency_key?: string | null
          result_summary?: Json | null
          rule_id: string
          status: string
          trigger_source: string
          workflow_id: string
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          idempotency_key?: string | null
          result_summary?: Json | null
          rule_id?: string
          status?: string
          trigger_source?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_rule_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "workflow_automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_rule_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_rule_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stage_content_tiles: {
        Row: {
          configuration: Json | null
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          is_enabled: boolean | null
          sort_order: number
          stage_id: string
          tile_type: string
          title: string
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          configuration?: Json | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          is_enabled?: boolean | null
          sort_order?: number
          stage_id: string
          tile_type: string
          title: string
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          configuration?: Json | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          is_enabled?: boolean | null
          sort_order?: number
          stage_id?: string
          tile_type?: string
          title?: string
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_workflow_stage_content_tiles_workflow"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_workflow_stage_content_tiles_workflow"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stages: {
        Row: {
          checklist_items: Json
          completion_criteria: string | null
          created_at: string | null
          default_assignee_type: string | null
          default_assignee_value: string | null
          id: string
          sort_order: number | null
          stage_color: string | null
          stage_description: string | null
          stage_description_extended: string | null
          stage_icon: string | null
          stage_key: string
          stage_label: string
          standard_deadline_days: number | null
          suggested_priorities: string[] | null
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          checklist_items?: Json
          completion_criteria?: string | null
          created_at?: string | null
          default_assignee_type?: string | null
          default_assignee_value?: string | null
          id?: string
          sort_order?: number | null
          stage_color?: string | null
          stage_description?: string | null
          stage_description_extended?: string | null
          stage_icon?: string | null
          stage_key: string
          stage_label: string
          standard_deadline_days?: number | null
          suggested_priorities?: string[] | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          checklist_items?: Json
          completion_criteria?: string | null
          created_at?: string | null
          default_assignee_type?: string | null
          default_assignee_value?: string | null
          id?: string
          sort_order?: number | null
          stage_color?: string | null
          stage_description?: string | null
          stage_description_extended?: string | null
          stage_icon?: string | null
          stage_key?: string
          stage_label?: string
          standard_deadline_days?: number | null
          suggested_priorities?: string[] | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_stages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_stakeholders: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          user_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          user_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stakeholders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_stakeholders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_stakeholders_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_stakeholders_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_template_versions: {
        Row: {
          automation_rules: Json | null
          checklist_templates: Json | null
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          is_active: boolean | null
          major_version: number | null
          minor_version: number | null
          stages: Json
          universe_rules: Json | null
          version_name: string | null
          version_number: number
          version_type: string | null
          workflow_id: string
        }
        Insert: {
          automation_rules?: Json | null
          checklist_templates?: Json | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          major_version?: number | null
          minor_version?: number | null
          stages: Json
          universe_rules?: Json | null
          version_name?: string | null
          version_number: number
          version_type?: string | null
          workflow_id: string
        }
        Update: {
          automation_rules?: Json | null
          checklist_templates?: Json | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          major_version?: number | null
          minor_version?: number | null
          stages?: Json
          universe_rules?: Json | null
          version_name?: string | null
          version_number?: number
          version_type?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_template_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_template_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string | null
          description: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          name: string
          updated_at: string | null
          uploaded_by: string
          workflow_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          name: string
          updated_at?: string | null
          uploaded_by: string
          workflow_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          name?: string
          updated_at?: string | null
          uploaded_by?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_templates_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_universe_overrides: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          override_type: string
          workflow_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          override_type: string
          workflow_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          override_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_universe_overrides_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_universe_overrides_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_universe_overrides_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_universe_rules: {
        Row: {
          combination_operator: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          rule_config: Json
          rule_type: string
          sort_order: number
          updated_at: string
          workflow_id: string
        }
        Insert: {
          combination_operator?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          rule_config?: Json
          rule_type: string
          sort_order?: number
          updated_at?: string
          workflow_id: string
        }
        Update: {
          combination_operator?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          rule_config?: Json
          rule_type?: string
          sort_order?: number
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_universe_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_universe_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_universe_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          auto_branch_name: string | null
          auto_create_branch: boolean | null
          branch_suffix: string | null
          branched_at: string | null
          cadence_days: number | null
          cadence_timeframe: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          deleted: boolean | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          ended_at: string | null
          id: string
          is_default: boolean | null
          is_public: boolean | null
          kickoff_cadence: string | null
          kickoff_custom_date: string | null
          metadata: Json | null
          name: string
          organization_id: string
          parent_workflow_id: string | null
          scope_type: string
          source_branch_id: string | null
          status: string | null
          template_version_id: string | null
          template_version_number: number | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          auto_branch_name?: string | null
          auto_create_branch?: boolean | null
          branch_suffix?: string | null
          branched_at?: string | null
          cadence_days?: number | null
          cadence_timeframe?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          ended_at?: string | null
          id?: string
          is_default?: boolean | null
          is_public?: boolean | null
          kickoff_cadence?: string | null
          kickoff_custom_date?: string | null
          metadata?: Json | null
          name: string
          organization_id: string
          parent_workflow_id?: string | null
          scope_type?: string
          source_branch_id?: string | null
          status?: string | null
          template_version_id?: string | null
          template_version_number?: number | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          auto_branch_name?: string | null
          auto_create_branch?: boolean | null
          branch_suffix?: string | null
          branched_at?: string | null
          cadence_days?: number | null
          cadence_timeframe?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          ended_at?: string | null
          id?: string
          is_default?: boolean | null
          is_public?: boolean | null
          kickoff_cadence?: string | null
          kickoff_custom_date?: string | null
          metadata?: Json | null
          name?: string
          organization_id?: string
          parent_workflow_id?: string | null
          scope_type?: string
          source_branch_id?: string | null
          status?: string | null
          template_version_id?: string | null
          template_version_number?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_parent_workflow_id_fkey"
            columns: ["parent_workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_parent_workflow_id_fkey"
            columns: ["parent_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      expired_targets_needing_update: {
        Row: {
          analyst_name: string | null
          asset_id: string | null
          asset_name: string | null
          asset_symbol: string | null
          expired_at: string | null
          expired_date: string | null
          expired_price: number | null
          price_target_id: string | null
          scenario_type: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_target_outcomes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_target_outcomes_price_target_id_fkey"
            columns: ["price_target_id"]
            isOneToOne: true
            referencedRelation: "analyst_price_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_target_outcomes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_calendar_events_v: {
        Row: {
          all_day: boolean | null
          assigned_to: string | null
          color: string | null
          context_id: string | null
          context_title: string | null
          context_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          event_type: Database["public"]["Enums"]["calendar_event_type"] | null
          id: string | null
          is_recurring: boolean | null
          location: string | null
          organization_id: string | null
          parent_event_id: string | null
          priority: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          start_date: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          all_day?: boolean | null
          assigned_to?: string | null
          color?: string | null
          context_id?: string | null
          context_title?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"] | null
          id?: string | null
          is_recurring?: boolean | null
          location?: string | null
          organization_id?: string | null
          parent_event_id?: string | null
          priority?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_date?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          all_day?: boolean | null
          assigned_to?: string | null
          color?: string | null
          context_id?: string | null
          context_title?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"] | null
          id?: string | null
          is_recurring?: boolean | null
          location?: string | null
          organization_id?: string | null
          parent_event_id?: string | null
          priority?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          start_date?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "org_calendar_events_v"
            referencedColumns: ["id"]
          },
        ]
      }
      org_captures_v: {
        Row: {
          capture_type: string | null
          created_at: string | null
          created_by: string | null
          display_title: string | null
          entity_display: string | null
          entity_id: string | null
          entity_type: string | null
          external_description: string | null
          external_favicon_url: string | null
          external_image_url: string | null
          external_metadata: Json | null
          external_title: string | null
          external_url: string | null
          id: string | null
          is_expanded: boolean | null
          organization_id: string | null
          preview_height: number | null
          preview_width: number | null
          screenshot_notes: string | null
          screenshot_source_url: string | null
          screenshot_storage_path: string | null
          screenshot_tags: string[] | null
          snapshot_at: string | null
          snapshot_data: Json | null
          source_id: string | null
          source_type: string | null
          updated_at: string | null
        }
        Insert: {
          capture_type?: string | null
          created_at?: string | null
          created_by?: string | null
          display_title?: string | null
          entity_display?: string | null
          entity_id?: string | null
          entity_type?: string | null
          external_description?: string | null
          external_favicon_url?: string | null
          external_image_url?: string | null
          external_metadata?: Json | null
          external_title?: string | null
          external_url?: string | null
          id?: string | null
          is_expanded?: boolean | null
          organization_id?: string | null
          preview_height?: number | null
          preview_width?: number | null
          screenshot_notes?: string | null
          screenshot_source_url?: string | null
          screenshot_storage_path?: string | null
          screenshot_tags?: string[] | null
          snapshot_at?: string | null
          snapshot_data?: Json | null
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
        }
        Update: {
          capture_type?: string | null
          created_at?: string | null
          created_by?: string | null
          display_title?: string | null
          entity_display?: string | null
          entity_id?: string | null
          entity_type?: string | null
          external_description?: string | null
          external_favicon_url?: string | null
          external_image_url?: string | null
          external_metadata?: Json | null
          external_title?: string | null
          external_url?: string | null
          id?: string | null
          is_expanded?: boolean | null
          organization_id?: string | null
          preview_height?: number | null
          preview_width?: number | null
          screenshot_notes?: string | null
          screenshot_source_url?: string | null
          screenshot_storage_path?: string | null
          screenshot_tags?: string[] | null
          snapshot_at?: string | null
          snapshot_data?: Json | null
          source_id?: string | null
          source_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "captures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_org_chart_nodes_v: {
        Row: {
          color: string | null
          coverage_admin_override: boolean | null
          created_at: string | null
          created_by: string | null
          custom_type_label: string | null
          description: string | null
          icon: string | null
          id: string | null
          is_active: boolean | null
          is_non_investment: boolean | null
          name: string | null
          node_type: string | null
          organization_id: string | null
          parent_id: string | null
          settings: Json | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          coverage_admin_override?: boolean | null
          created_at?: string | null
          created_by?: string | null
          custom_type_label?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          is_non_investment?: boolean | null
          name?: string | null
          node_type?: string | null
          organization_id?: string | null
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          coverage_admin_override?: boolean | null
          created_at?: string | null
          created_by?: string | null
          custom_type_label?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_active?: boolean | null
          is_non_investment?: boolean | null
          name?: string | null
          node_type?: string | null
          organization_id?: string | null
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_chart_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_chart_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
        ]
      }
      org_projects_v: {
        Row: {
          blocked_reason: string | null
          board_position: number | null
          completed_at: string | null
          context_id: string | null
          context_type: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string | null
          org_group_id: string | null
          organization_id: string | null
          priority: Database["public"]["Enums"]["project_priority"] | null
          status: Database["public"]["Enums"]["project_status"] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          blocked_reason?: string | null
          board_position?: number | null
          completed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string | null
          org_group_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["project_priority"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          blocked_reason?: string | null
          board_position?: number | null
          completed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string | null
          org_group_id?: string | null
          organization_id?: string | null
          priority?: Database["public"]["Enums"]["project_priority"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_chart_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_group_id_fkey"
            columns: ["org_group_id"]
            isOneToOne: false
            referencedRelation: "org_org_chart_nodes_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_themes_v: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string | null
          is_archived: boolean | null
          is_public: boolean | null
          lifecycle_status:
            | Database["public"]["Enums"]["theme_lifecycle_status"]
            | null
          name: string | null
          organization_id: string | null
          theme_type: Database["public"]["Enums"]["theme_type"] | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_archived?: boolean | null
          is_public?: boolean | null
          lifecycle_status?:
            | Database["public"]["Enums"]["theme_lifecycle_status"]
            | null
          name?: string | null
          organization_id?: string | null
          theme_type?: Database["public"]["Enums"]["theme_type"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string | null
          is_archived?: boolean | null
          is_public?: boolean | null
          lifecycle_status?:
            | Database["public"]["Enums"]["theme_lifecycle_status"]
            | null
          name?: string | null
          organization_id?: string | null
          theme_type?: Database["public"]["Enums"]["theme_type"] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "themes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "themes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_topics_v: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          name: string | null
          organization_id: string | null
          slug: string | null
          updated_at: string | null
          visibility: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          organization_id?: string | null
          slug?: string | null
          updated_at?: string | null
          visibility?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          organization_id?: string | null
          slug?: string | null
          updated_at?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_workflows_v: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          auto_branch_name: string | null
          auto_create_branch: boolean | null
          branch_suffix: string | null
          branched_at: string | null
          cadence_days: number | null
          cadence_timeframe: string | null
          color: string | null
          created_at: string | null
          created_by: string | null
          deleted: boolean | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string | null
          is_default: boolean | null
          is_public: boolean | null
          kickoff_cadence: string | null
          kickoff_custom_date: string | null
          name: string | null
          organization_id: string | null
          parent_workflow_id: string | null
          scope_type: string | null
          source_branch_id: string | null
          status: string | null
          template_version_id: string | null
          template_version_number: number | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          auto_branch_name?: string | null
          auto_create_branch?: boolean | null
          branch_suffix?: string | null
          branched_at?: string | null
          cadence_days?: number | null
          cadence_timeframe?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string | null
          is_default?: boolean | null
          is_public?: boolean | null
          kickoff_cadence?: string | null
          kickoff_custom_date?: string | null
          name?: string | null
          organization_id?: string | null
          parent_workflow_id?: string | null
          scope_type?: string | null
          source_branch_id?: string | null
          status?: string | null
          template_version_id?: string | null
          template_version_number?: number | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          auto_branch_name?: string | null
          auto_create_branch?: boolean | null
          branch_suffix?: string | null
          branched_at?: string | null
          cadence_days?: number | null
          cadence_timeframe?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string | null
          is_default?: boolean | null
          is_public?: boolean | null
          kickoff_cadence?: string | null
          kickoff_custom_date?: string | null
          name?: string | null
          organization_id?: string | null
          parent_workflow_id?: string | null
          scope_type?: string | null
          source_branch_id?: string | null
          status?: string | null
          template_version_id?: string | null
          template_version_number?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_parent_workflow_id_fkey"
            columns: ["parent_workflow_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_parent_workflow_id_fkey"
            columns: ["parent_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "org_workflows_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_source_branch_id_fkey"
            columns: ["source_branch_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members_v: {
        Row: {
          compliance_areas: Json | null
          created_at: string | null
          geography_focus: Json | null
          id: string | null
          investment_style: Json | null
          is_org_admin: boolean | null
          joined_at: string | null
          market_cap_focus: Json | null
          membership_title: string | null
          ops_departments: Json | null
          organization_id: string | null
          profile_title: string | null
          profile_user_type: string | null
          role_id: string | null
          sector_focus: Json | null
          status: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          time_horizon: Json | null
          user_coverage_admin: boolean | null
          user_email: string | null
          user_first_name: string | null
          user_full_name: string | null
          user_id: string | null
          user_last_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "user_role_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _emit_coverage_notification: {
        Args: {
          action_kind: string
          actor_id: string
          asset_ids: string[]
          recipient_id: string
          symbols: string[]
        }
        Returns: undefined
      }
      accept_org_invite: { Args: { p_token: string }; Returns: Json }
      acknowledge_attention: {
        Args: { p_attention_id: string }
        Returns: undefined
      }
      activate_template_version: {
        Args: { p_version_id: string }
        Returns: boolean
      }
      add_field_from_preset: {
        Args: {
          p_organization_id: string
          p_preset_slug: string
          p_section_slug?: string
        }
        Returns: string
      }
      apply_audit_log_retention: { Args: never; Returns: Json }
      approve_access_request: {
        Args: { p_new_status: string; p_notes?: string; p_request_id: string }
        Returns: Json
      }
      approve_org_join_request: {
        Args: { p_new_status: string; p_notes?: string; p_request_id: string }
        Returns: Json
      }
      archive_org: { Args: { p_org_id: string }; Returns: undefined }
      archive_portfolio: {
        Args: { p_portfolio_id: string }
        Returns: undefined
      }
      auto_accept_pending_invites: { Args: never; Returns: Json }
      bootstrap_organization: {
        Args: {
          p_description?: string
          p_logo_url?: string
          p_name: string
          p_seed_defaults?: boolean
          p_slug: string
        }
        Returns: Json
      }
      calculate_accuracy: {
        Args: { p_actual_price: number; p_target_price: number }
        Returns: number
      }
      calculate_aggregated_price: {
        Args: {
          p_include_opinions?: boolean
          p_method?: string
          p_scenario_id: string
        }
        Returns: {
          aggregated_price: number
          analyst_count: number
          max_price: number
          min_price: number
        }[]
      }
      calculate_branch_end_time: {
        Args: { p_branched_at: string; p_condition_value: Json }
        Returns: string
      }
      calculate_next_run_time: {
        Args: { p_condition_value: Json; p_from_time?: string }
        Returns: string
      }
      calculate_target_date:
        | {
            Args: { p_created_at: string; p_timeframe: string }
            Returns: string
          }
        | {
            Args: {
              p_created_at: string
              p_is_rolling?: boolean
              p_target_date?: string
              p_timeframe: string
              p_timeframe_type?: string
            }
            Returns: string
          }
      can_discard_portfolio: { Args: { p_portfolio_id: string }; Returns: Json }
      can_modify_trade_stage: {
        Args: { p_trade_id: string; p_user_id: string }
        Returns: boolean
      }
      can_user_edit_simulation: {
        Args: { sim_id: string; user_uuid: string }
        Returns: boolean
      }
      can_view_contribution: {
        Args: {
          p_contribution_team_id: string
          p_user_id: string
          p_visibility: string
        }
        Returns: boolean
      }
      cancel_export_job: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: undefined
      }
      cancel_org_deletion: { Args: { p_org_id: string }; Returns: undefined }
      carry_forward_holdings: {
        Args: { p_target_date?: string }
        Returns: number
      }
      check_and_expire_user_targets: {
        Args: { p_user_id: string }
        Returns: number
      }
      claim_next_export_job: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          error: string | null
          error_code: string | null
          error_message: string | null
          file_path: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_attempt_at: string | null
          organization_id: string
          requested_by: string
          result_bytes: number | null
          result_expires_at: string | null
          result_url: string | null
          scope: string
          started_at: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "org_export_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_org_deletion: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          org_name: string
          organization_id: string
        }[]
      }
      cleanup_expired_ai_insights: { Args: never; Returns: number }
      cleanup_stale_sessions: { Args: never; Returns: number }
      complete_export_job: {
        Args: {
          p_bytes?: number
          p_expires_at?: string
          p_job_id: string
          p_result_url?: string
          p_storage_path: string
        }
        Returns: undefined
      }
      compute_next_run_at: {
        Args: {
          p_condition_type: string
          p_condition_value: Json
          p_from_time: string
        }
        Returns: string
      }
      copy_workflow_with_unique_name: {
        Args: {
          copy_progress?: boolean
          source_workflow_id: string
          suffix: string
          target_user_id: string
        }
        Returns: string
      }
      create_asset_change_notification: {
        Args: {
          asset_id_param: string
          context_data_param?: Json
          message_param: string
          notification_type_param: Database["public"]["Enums"]["notification_type"]
          title_param: string
        }
        Returns: undefined
      }
      create_default_lists_for_user: {
        Args: { user_id: string }
        Returns: undefined
      }
      create_domain_verification: { Args: { p_domain: string }; Returns: Json }
      create_group_conversation: {
        Args: {
          group_description?: string
          group_name: string
          member_ids?: string[]
        }
        Returns: string
      }
      create_initial_template_version: {
        Args: { p_workflow_id: string }
        Returns: string
      }
      create_new_template_version: {
        Args: {
          p_description?: string
          p_version_name?: string
          p_version_type?: string
          p_workflow_id: string
        }
        Returns: string
      }
      create_note_collaboration_notification: {
        Args: {
          exclude_user_id?: string
          message_param: string
          note_id_param: string
          note_type_param: string
          notification_type_param: Database["public"]["Enums"]["notification_type"]
          title_param: string
        }
        Returns: undefined
      }
      create_note_version: {
        Args: {
          p_content: string
          p_note_id: string
          p_note_type: string
          p_note_type_category: string
          p_reason?: string
          p_title: string
          p_user_id: string
        }
        Returns: string
      }
      create_org_invite: {
        Args: {
          p_email: string
          p_is_org_admin?: boolean
          p_organization_id: string
        }
        Returns: Json
      }
      create_plan_from_simulation: {
        Args: { p_name?: string; p_simulation_id: string }
        Returns: string
      }
      create_trade_sheet: {
        Args: {
          p_description?: string
          p_lab_id: string
          p_name: string
          p_user_id: string
          p_view_id?: string
        }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      deactivate_org_member: {
        Args: { p_reason?: string; p_target_user_id: string }
        Returns: Json
      }
      decision_reflections_payload: {
        Args: { p_decision_id: string }
        Returns: Json
      }
      decision_story_payload: {
        Args: { p_decision_id: string; p_execution_event_id?: string }
        Returns: Json
      }
      delete_identity_provider: {
        Args: { p_provider_id: string }
        Returns: undefined
      }
      delete_pilot_scenario: {
        Args: { p_scenario_id: string }
        Returns: undefined
      }
      discard_portfolio: {
        Args: { p_portfolio_id: string; p_reason?: string }
        Returns: Json
      }
      dismiss_attention: {
        Args: { p_attention_id: string }
        Returns: undefined
      }
      dismiss_attention_with_reason: {
        Args: { p_attention_id: string; p_note?: string; p_reason?: string }
        Returns: undefined
      }
      end_morph_session: { Args: { p_session_id: string }; Returns: undefined }
      end_session: { Args: { p_session_id: string }; Returns: undefined }
      ensure_default_scenarios: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      ensure_pilot_decision_request_for_user: {
        Args: { p_user_id?: string }
        Returns: string
      }
      ensure_pilot_scenario_for_user: {
        Args: { p_force_reset?: boolean; p_user_id?: string }
        Returns: Json
      }
      evaluate_pending_rules: { Args: never; Returns: Json }
      execute_due_automation_rules: {
        Args: never
        Returns: {
          out_action_taken: string
          out_executed_at: string
          out_new_branch_id: string
          out_rule_id: string
          out_rule_name: string
          out_workflow_id: string
          out_workflow_name: string
        }[]
      }
      execute_org_deletion: { Args: { p_org_id: string }; Returns: undefined }
      execute_overdue_ending_rules: { Args: never; Returns: number }
      execute_scheduled_branch_creation_rules: {
        Args: never
        Returns: {
          out_new_branch_id: string
          out_new_branch_name: string
          out_rule_name: string
          out_template_version_number: number
          out_workflow_id: string
          out_workflow_name: string
        }[]
      }
      execute_single_automation_rule: {
        Args: {
          p_rule_id: string
          p_trigger_source?: string
          p_user_id?: string
        }
        Returns: Json
      }
      execute_workflow_automation_action: {
        Args: {
          p_action_type: string
          p_action_value: Json
          p_asset_id: string
          p_user_id: string
          p_workflow_id: string
        }
        Returns: undefined
      }
      fail_export_job: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_job_id: string
          p_retry_in_seconds?: number
        }
        Returns: undefined
      }
      generate_unique_workflow_name: {
        Args: { base_name: string; suffix: string; user_id?: string }
        Returns: string
      }
      get_accepted_trade_recipients: {
        Args: { at_id: string; exclude_user: string }
        Returns: {
          user_id: string
        }[]
      }
      get_asset_field_history: {
        Args: { p_asset_id: string; p_field_name?: string }
        Returns: {
          changed_at: string
          changed_by: string
          changed_by_email: string
          changed_by_name: string
          field_name: string
          id: string
          new_value: string
          old_value: string
        }[]
      }
      get_asset_insights: {
        Args: { asset_ids: string[] }
        Returns: {
          asset_id: string
          confidence: number
          expires_at: string
          explanation: string
          id: string
          insight_type: string
          label: string
          metadata: Json
          severity: string
        }[]
      }
      get_asset_notification_users: {
        Args: { asset_id_param: string }
        Returns: {
          user_email: string
          user_id: string
          user_name: string
        }[]
      }
      get_default_asset_sections: { Args: never; Returns: Json }
      get_effective_ai_config: {
        Args: { p_user_id: string }
        Returns: {
          include_discussions: boolean
          include_notes: boolean
          include_outcomes: boolean
          include_thesis: boolean
          is_configured: boolean
          mode: string
          model: string
          provider: string
        }[]
      }
      get_estimate_consensus: {
        Args: {
          p_asset_id: string
          p_fiscal_quarter?: number
          p_fiscal_year: number
          p_method?: string
          p_metric_key: string
        }
        Returns: {
          analyst_count: number
          consensus_value: number
          max_value: number
          min_value: number
          std_dev: number
        }[]
      }
      get_export_download_url: { Args: { p_job_id: string }; Returns: string }
      get_field_history: {
        Args: {
          p_field_name?: string
          p_record_id: string
          p_table_name: string
        }
        Returns: {
          change_type: string
          changed_at: string
          changed_by: string
          changed_by_email: string
          field_name: string
          id: string
          new_value: string
          old_value: string
        }[]
      }
      get_identity_provider_for_email: {
        Args: { p_email: string }
        Returns: Json
      }
      get_latest_list_activities: {
        Args: { p_list_ids: string[] }
        Returns: {
          activity_type: string
          actor_name: string
          created_at: string
          list_id: string
          metadata: Json
        }[]
      }
      get_layout_permission: {
        Args: { p_layout_id: string; p_user_id: string }
        Returns: string
      }
      get_list_activity_counts: {
        Args: { p_user_id: string }
        Returns: {
          list_id: string
          self_count: number
          update_count: number
        }[]
      }
      get_next_note_version_number: {
        Args: { p_note_id: string; p_note_type: string }
        Returns: number
      }
      get_or_create_direct_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      get_or_create_lab_my_drafts_view: {
        Args: { p_lab_id: string; p_user_id: string }
        Returns: string
      }
      get_or_create_portfolio_view: {
        Args: { p_lab_id: string }
        Returns: string
      }
      get_or_create_portfolio_working_set: {
        Args: { p_lab_id: string }
        Returns: string
      }
      get_or_create_private_view: {
        Args: { p_lab_id: string; p_user_id: string }
        Returns: string
      }
      get_or_create_trade_lab: {
        Args: { p_portfolio_id: string }
        Returns: string
      }
      get_org_ai_config_for_resolution: {
        Args: { p_org_id: string }
        Returns: {
          byok_api_key: string
          byok_enabled: boolean
          byok_model: string
          byok_provider: string
        }[]
      }
      get_org_ai_config_summary: {
        Args: never
        Returns: {
          byok_enabled: boolean
          byok_model: string
          byok_provider: string
          is_configured: boolean
          organization_id: string
        }[]
      }
      get_pending_branch_endings: {
        Args: never
        Returns: {
          action_type: string
          branch_id: string
          branch_name: string
          branched_at: string
          is_overdue: boolean
          parent_workflow_id: string
          parent_workflow_name: string
          rule_name: string
          scheduled_end_time: string
          time_remaining: string
        }[]
      }
      get_rating_consensus: {
        Args: { p_asset_id: string }
        Returns: {
          rating_count: number
          rating_value: string
          total_analysts: number
        }[]
      }
      get_rounding_config: {
        Args: { p_asset_id: string; p_portfolio_id: string }
        Returns: Json
      }
      get_tenant_lint_tables: {
        Args: never
        Returns: {
          has_org_id: boolean
          org_id_nullable: string
          policy_count: number
          rls_enabled: boolean
          table_name: string
        }[]
      }
      get_trade_idea_team: {
        Args: { item_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_user_created_project_ids: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      get_user_expired_targets: {
        Args: { p_user_id: string }
        Returns: {
          asset_id: string
          asset_name: string
          asset_symbol: string
          expired_at: string
          expired_date: string
          expired_price: number
          scenario_type: string
        }[]
      }
      get_user_org_id: { Args: { uid: string }; Returns: string }
      get_user_organization: { Args: { p_user_id: string }; Returns: string }
      get_user_simulation_ids: {
        Args: { user_uuid: string }
        Returns: string[]
      }
      global_search: {
        Args: { result_limit?: number; search_query: string }
        Returns: Json
      }
      grant_temporary_org_membership: {
        Args: {
          p_duration_minutes?: number
          p_org_id: string
          p_user_id: string
        }
        Returns: Json
      }
      has_active_morph_session: { Args: never; Returns: boolean }
      has_note_permission: {
        Args: {
          p_note_id: string
          p_note_type: string
          p_required_permission?: string
          p_user_id: string
        }
        Returns: boolean
      }
      is_active_member_of_current_org: { Args: never; Returns: boolean }
      is_active_org_admin_of_current_org: { Args: never; Returns: boolean }
      is_coverage_admin: { Args: never; Returns: boolean }
      is_covering_analyst: {
        Args: { p_asset_id: string; p_user_id: string }
        Returns: boolean
      }
      is_current_pilot_session: { Args: never; Returns: boolean }
      is_morphing_into_user: { Args: { p_user_id: string }; Returns: boolean }
      is_org_archived: { Args: { p_org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_portfolio_pm: {
        Args: { p_portfolio_id: string; p_user_id: string }
        Returns: boolean
      }
      is_simulation_admin: {
        Args: { sim_id: string; user_uuid: string }
        Returns: boolean
      }
      is_team_admin_for_field: {
        Args: { p_team_field_id: string }
        Returns: boolean
      }
      is_user_org_admin: { Args: { uid: string }; Returns: boolean }
      lab_has_conflicts: { Args: { p_lab_id: string }; Returns: boolean }
      log_org_activity_event:
        | {
            Args: {
              p_action: string
              p_action_type?: string
              p_details?: Json
              p_entity_type?: string
              p_metadata?: Json
              p_organization_id: string
              p_source_id?: string
              p_source_type?: string
              p_target_id?: string
              p_target_type: string
              p_target_user_id?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_action: string
              p_action_type?: string
              p_details?: Json
              p_entity_type?: string
              p_initiator_user_id?: string
              p_metadata?: Json
              p_organization_id: string
              p_source_id?: string
              p_source_type?: string
              p_target_id?: string
              p_target_type: string
              p_target_user_id?: string
            }
            Returns: undefined
          }
      log_org_activity_events_batch: {
        Args: { p_events: Json }
        Returns: undefined
      }
      log_project_activity: {
        Args: {
          p_activity_type: string
          p_actor_id?: string
          p_field_name?: string
          p_metadata?: Json
          p_new_value?: string
          p_old_value?: string
          p_project_id: string
        }
        Returns: string
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_attention_read: {
        Args: { p_attention_id: string }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { notification_id: string }
        Returns: undefined
      }
      morph_restore_org: { Args: { p_org_id: string }; Returns: undefined }
      morph_switch_org: { Args: { p_org_id: string }; Returns: undefined }
      notify_price_target_expired: {
        Args: {
          p_asset_id: string
          p_asset_name: string
          p_asset_symbol: string
          p_price_target_id: string
          p_scenario_name: string
          p_target_date: string
          p_target_price: number
          p_user_id: string
        }
        Returns: undefined
      }
      outcomes_payload: { Args: { p_filters?: Json }; Returns: Json }
      populate_asset_run_from_universe: {
        Args: { p_branch_id: string; p_template_id: string }
        Returns: number
      }
      portfolio_in_current_org: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      position_chart_payload: {
        Args: { p_asset_id: string; p_portfolio_id: string; p_symbol: string }
        Returns: Json
      }
      process_branch_ending_rules: {
        Args: never
        Returns: {
          action_taken: string
          assets_completed: number
          branch_id: string
          branch_name: string
          rule_name: string
        }[]
      }
      process_dynamic_suffix: { Args: { suffix: string }; Returns: string }
      process_expired_price_targets: { Args: never; Returns: number }
      provision_client_org: {
        Args: {
          p_admin_email: string
          p_name: string
          p_settings?: Json
          p_slug: string
        }
        Returns: Json
      }
      reactivate_org_member: {
        Args: { p_reason?: string; p_target_user_id: string }
        Returns: Json
      }
      recompute_workflow_rule_schedules: {
        Args: { p_user_id: string; p_workflow_id: string }
        Returns: Json
      }
      record_investment_case_template_usage: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      release_stale_deletion_locks: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      release_stale_export_locks: {
        Args: { p_max_age?: string }
        Returns: number
      }
      request_org_export: {
        Args: { p_org_id: string; p_scope?: string }
        Returns: string
      }
      resolve_entity_org: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: string
      }
      restore_portfolio: {
        Args: { p_portfolio_id: string }
        Returns: undefined
      }
      revoke_temporary_org_membership: {
        Args: { p_org_id: string; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      route_org_for_email: { Args: { p_email: string }; Returns: Json }
      save_asset_content: {
        Args: { p_asset_id: string; p_content: string; p_table_name: string }
        Returns: Json
      }
      save_asset_layout_customization: {
        Args: {
          p_asset_id: string
          p_clear_all?: boolean
          p_expected_version?: number
          p_field_overrides?: Json
          p_layout_id?: string
          p_new_sections?: Json
          p_section_overrides?: Json
        }
        Returns: Json
      }
      schedule_org_deletion: {
        Args: { p_at: string; p_org_id: string }
        Returns: undefined
      }
      seed_default_research_catalog: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_default_theme_research_catalog: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_default_workflows_for_org: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_gics_sector_themes: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_pilot_pipeline_demo_ideas: {
        Args: { p_user_id?: string }
        Returns: number
      }
      seed_pilot_template_portfolio: {
        Args: {
          p_benchmark: string
          p_cash_pct?: number
          p_name: string
          p_org_id: string
          p_pm_user_id?: string
          p_positions: Json
          p_sample_ideas?: Json
        }
        Returns: Json
      }
      session_heartbeat: { Args: { p_session_id: string }; Returns: undefined }
      set_current_org: { Args: { p_org_id: string }; Returns: undefined }
      set_org_governance: {
        Args: {
          p_legal_hold?: boolean
          p_org_id: string
          p_retention_days?: number
        }
        Returns: Json
      }
      snooze_attention: {
        Args: { p_attention_id: string; p_until: string }
        Returns: undefined
      }
      sso_get_provider_config: { Args: { p_org_id: string }; Returns: Json }
      stage_pilot_scenario:
        | {
            Args: {
              p_asset_id?: string
              p_delta_weight_pct?: number
              p_direction?: string
              p_organization_id: string
              p_portfolio_id?: string
              p_proposed_action?: string
              p_proposed_sizing_input?: string
              p_symbol?: string
              p_target_weight_pct?: number
              p_thesis?: string
              p_title: string
              p_user_id?: string
              p_why_now?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_asset_id?: string
              p_delta_weight_pct?: number
              p_direction?: string
              p_is_template?: boolean
              p_organization_id: string
              p_portfolio_id?: string
              p_proposed_action?: string
              p_proposed_sizing_input?: string
              p_symbol?: string
              p_target_weight_pct?: number
              p_thesis?: string
              p_title: string
              p_user_id?: string
              p_why_now?: string
            }
            Returns: Json
          }
      start_morph_session: {
        Args: {
          p_duration_minutes?: number
          p_reason: string
          p_target_user_id: string
        }
        Returns: Json
      }
      trigger_automation_check: {
        Args: never
        Returns: {
          action_taken: string
          executed_at: string
          new_branch_id: string
          rule_id: string
          rule_name: string
          workflow_id: string
          workflow_name: string
        }[]
      }
      uid: { Args: never; Returns: string }
      unarchive_portfolio: {
        Args: { p_portfolio_id: string }
        Returns: undefined
      }
      undismiss_attention: {
        Args: { p_attention_id: string }
        Returns: undefined
      }
      unsnooze_attention: {
        Args: { p_attention_id: string }
        Returns: undefined
      }
      update_asset_content:
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_content_type: string
              p_created_by?: string
              p_updated_by?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_table_name: string
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_table: string
              p_updated_by: string
            }
            Returns: undefined
          }
      update_asset_content_reliable: {
        Args: {
          p_asset_id: string
          p_content: string
          p_table_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      update_asset_risks_content:
        | {
            Args: { p_asset_id: string; p_content: string }
            Returns: undefined
          }
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_updated_by: string
            }
            Returns: undefined
          }
      update_asset_thesis_content:
        | {
            Args: { p_asset_id: string; p_content: string }
            Returns: undefined
          }
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_updated_by: string
            }
            Returns: undefined
          }
      update_asset_where_different_content:
        | {
            Args: { p_asset_id: string; p_content: string }
            Returns: undefined
          }
        | {
            Args: {
              p_asset_id: string
              p_content: string
              p_updated_by: string
            }
            Returns: undefined
          }
      update_content_simple: {
        Args: {
          p_asset_id: string
          p_content: string
          p_table_name: string
          p_user_id?: string
        }
        Returns: Json
      }
      update_current_content: {
        Args: {
          p_content: string
          p_record_id: string
          p_table: string
          p_updated_by: string
        }
        Returns: string
      }
      update_list_brief: {
        Args: { p_brief: string; p_list_id: string }
        Returns: undefined
      }
      upsert_identity_provider:
        | {
            Args: {
              p_client_id: string
              p_discovery_url: string
              p_enabled?: boolean
              p_organization_id: string
              p_sso_only?: boolean
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_id: string
              p_client_secret?: string
              p_discovery_url: string
              p_enabled?: boolean
              p_organization_id: string
              p_sso_only?: boolean
            }
            Returns: Json
          }
      user_has_collaborate_share: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      user_has_layout_access: {
        Args: {
          p_layout_id: string
          p_min_permission?: string
          p_user_id: string
        }
        Returns: boolean
      }
      user_has_list_collaboration: {
        Args: { p_list_id: string }
        Returns: boolean
      }
      user_has_live_portfolio_share: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      user_has_template_access: {
        Args: {
          p_min_permission?: string
          p_template_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      user_has_viewer_access: {
        Args: { p_team_field_id: string }
        Returns: boolean
      }
      user_has_workflow_access: {
        Args: { user_id_param: string; workflow_id_param: string }
        Returns: boolean
      }
      user_has_workflow_edit_access: {
        Args: { user_id_param: string; workflow_id_param: string }
        Returns: boolean
      }
      user_has_workflow_write_access: {
        Args: { user_id_param: string; workflow_id_param: string }
        Returns: boolean
      }
      user_is_portfolio_member: {
        Args: { p_portfolio_id: string; p_user_id?: string }
        Returns: boolean
      }
      verify_domain: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      action_type:
        | "thesis_edit"
        | "bull_case_edit"
        | "bear_case_edit"
        | "base_case_edit"
        | "price_target_add"
        | "price_target_edit"
        | "price_target_delete"
        | "priority_change"
        | "status_change"
        | "note_add"
        | "note_edit"
        | "note_delete"
        | "notebook_create"
        | "notebook_edit"
        | "notebook_delete"
        | "theme_create"
        | "theme_edit"
        | "theme_delete"
        | "portfolio_create"
        | "portfolio_edit"
        | "portfolio_delete"
      active_weight_source: "portfolio_benchmark" | "custom" | "index"
      allocation_view:
        | "strong_underweight"
        | "underweight"
        | "market_weight"
        | "overweight"
        | "strong_overweight"
      allocation_view_status: "draft" | "active" | "archived"
      allocation_vote_type: "agree" | "disagree" | "abstain"
      attention_read_state: "unread" | "read" | "acknowledged"
      calendar_event_type:
        | "earnings_call"
        | "conference"
        | "deadline"
        | "meeting"
        | "deliverable"
        | "task"
        | "reminder"
        | "other"
      collaboration_permission: "read" | "write" | "admin"
      holdings_source_type: "live_feed" | "manual_eod" | "paper"
      idea_type:
        | "thought"
        | "trade_idea"
        | "research_idea"
        | "thesis"
        | "prompt"
      link_relationship_type:
        | "references"
        | "supports"
        | "results_in"
        | "related_to"
        | "opposes"
        | "informs"
        | "derived_from"
      linkable_entity_type:
        | "asset_note"
        | "portfolio_note"
        | "theme_note"
        | "custom_note"
        | "asset"
        | "portfolio"
        | "theme"
        | "trade_idea"
        | "trade"
        | "trade_sheet"
        | "workflow"
        | "project"
        | "calendar_event"
        | "user"
        | "quick_thought"
        | "trade_proposal"
        | "trade_idea_thesis"
      min_lot_behavior: "round" | "zero" | "warn"
      note_type:
        | "meeting"
        | "call"
        | "research"
        | "idea"
        | "analysis"
        | "general"
        | "thesis_update"
        | "earnings"
        | "risk_review"
        | "trade_rationale"
        | "market_commentary"
        | "thesis"
        | "decision"
        | "risk"
      notebook_type: "asset" | "theme" | "portfolio" | "custom"
      notification_type:
        | "asset_field_change"
        | "asset_priority_change"
        | "asset_stage_change"
        | "note_shared"
        | "note_created"
        | "price_target_change"
        | "list_shared"
        | "theme_shared"
        | "workflow_shared"
        | "mention"
        | "workflow_invitation"
        | "task_assigned"
        | "stage_assigned"
        | "workflow_access_request"
        | "coverage_request"
        | "project_assigned"
        | "price_target_expired"
        | "decision_nudge"
        | "recommendation_submitted"
        | "recommendation_decided"
        | "simulation_shared"
        | "accepted_trade_committed"
        | "accepted_trade_status"
        | "accepted_trade_comment"
        | "trade_batch_status"
        | "decision_request_resolved"
        | "coverage_request_resolved"
        | "coverage_added"
        | "coverage_removed"
        | "ai_rate_limit_hit"
        | "ai_provider_error"
        | "org_membership_added"
        | "org_membership_status"
        | "org_role_changed"
        | "coverage_admin_changed"
      origin_entity_type:
        | "asset"
        | "portfolio"
        | "trade_lab"
        | "view"
        | "trade_idea"
      origin_type:
        | "asset_page"
        | "portfolio_page"
        | "trade_lab"
        | "search"
        | "dashboard"
        | "manual"
        | "counter_view"
      portfolio_decision_outcome: "accepted" | "deferred" | "rejected"
      price_target_type: "bull" | "base" | "bear"
      priority_level:
        | "high"
        | "medium"
        | "low"
        | "none"
        | "critical"
        | "maintenance"
      process_stage:
        | "research"
        | "analysis"
        | "monitoring"
        | "review"
        | "archived"
        | "outdated"
        | "initiated"
        | "prioritized"
        | "in_progress"
        | "recommend"
        | "action"
        | "none"
        | "monitor"
      project_assignment_role:
        | "owner"
        | "contributor"
        | "reviewer"
        | "lead"
        | "collaborator"
      project_priority: "low" | "medium" | "high" | "urgent"
      project_status:
        | "planning"
        | "in_progress"
        | "blocked"
        | "completed"
        | "cancelled"
      rationale_status: "draft" | "complete" | "reviewed"
      rationale_type:
        | "planned"
        | "reactive"
        | "execution_adjustment"
        | "risk_management"
        | "thesis_update"
        | "other"
      revision_event_category:
        | "thesis"
        | "where_different"
        | "risks_to_thesis"
        | "valuation_targets"
        | "supporting"
      revision_view_scope: "firm" | "user"
      simulation_permission: "view" | "comment" | "edit" | "admin"
      simulation_share_access: "view" | "suggest" | "collaborate"
      simulation_share_mode: "snapshot" | "live"
      simulation_status: "draft" | "running" | "completed" | "archived"
      sizing_framework:
        | "weight_target"
        | "weight_delta"
        | "active_target"
        | "active_delta"
        | "shares_target"
        | "shares_delta"
      tdf_trade_status: "proposed" | "approved" | "executed" | "cancelled"
      theme_lifecycle_status:
        | "emerging"
        | "active"
        | "playing_out"
        | "played_out"
        | "invalidated"
      theme_type: "sector" | "geography" | "strategy" | "macro" | "general"
      thought_date_type: "revisit" | "alert" | "expiration"
      thought_sentiment:
        | "bullish"
        | "bearish"
        | "neutral"
        | "curious"
        | "concerned"
        | "excited"
      thought_source_type:
        | "news_article"
        | "headline"
        | "research"
        | "earnings"
        | "price_move"
        | "social_media"
        | "conversation"
        | "idea"
        | "general"
        | "other"
      thought_visibility: "private" | "team" | "public" | "organization"
      trade_action: "buy" | "sell" | "trim" | "add"
      trade_event_action:
        | "initiate"
        | "add"
        | "trim"
        | "exit"
        | "reduce"
        | "cover"
        | "short_initiate"
        | "rebalance"
        | "hedge"
        | "other"
      trade_event_source:
        | "holdings_diff"
        | "execution_import"
        | "manual"
        | "reconciliation"
      trade_event_status:
        | "pending_rationale"
        | "draft_rationale"
        | "complete"
        | "reviewed"
        | "ignored"
      trade_event_type:
        | "created"
        | "proposal_created"
        | "proposal_updated"
        | "proposal_snapshot"
        | "moved_to_deciding"
        | "moved_to_simulating"
        | "approved"
        | "rejected"
        | "executed"
        | "sizing_changed"
        | "note_added"
        | "status_changed"
        | "proposal_withdrawn"
      trade_lab_view_role: "owner" | "editor" | "viewer"
      trade_lab_view_type: "private" | "shared" | "portfolio"
      trade_outcome: "executed" | "rejected" | "deferred"
      trade_queue_status:
        | "idea"
        | "discussing"
        | "approved"
        | "rejected"
        | "executed"
        | "cancelled"
        | "deleted"
        | "deciding"
        | "simulating"
        | "archived"
      trade_sheet_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "sent_to_desk"
        | "executed"
        | "cancelled"
      trade_stage:
        | "idea"
        | "discussing"
        | "simulating"
        | "deciding"
        | "working_on"
        | "modeling"
        | "aware"
        | "investigate"
        | "deep_research"
        | "thesis_forming"
        | "ready_for_decision"
      visibility_tier: "active" | "trash" | "archive"
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
    Enums: {
      action_type: [
        "thesis_edit",
        "bull_case_edit",
        "bear_case_edit",
        "base_case_edit",
        "price_target_add",
        "price_target_edit",
        "price_target_delete",
        "priority_change",
        "status_change",
        "note_add",
        "note_edit",
        "note_delete",
        "notebook_create",
        "notebook_edit",
        "notebook_delete",
        "theme_create",
        "theme_edit",
        "theme_delete",
        "portfolio_create",
        "portfolio_edit",
        "portfolio_delete",
      ],
      active_weight_source: ["portfolio_benchmark", "custom", "index"],
      allocation_view: [
        "strong_underweight",
        "underweight",
        "market_weight",
        "overweight",
        "strong_overweight",
      ],
      allocation_view_status: ["draft", "active", "archived"],
      allocation_vote_type: ["agree", "disagree", "abstain"],
      attention_read_state: ["unread", "read", "acknowledged"],
      calendar_event_type: [
        "earnings_call",
        "conference",
        "deadline",
        "meeting",
        "deliverable",
        "task",
        "reminder",
        "other",
      ],
      collaboration_permission: ["read", "write", "admin"],
      holdings_source_type: ["live_feed", "manual_eod", "paper"],
      idea_type: ["thought", "trade_idea", "research_idea", "thesis", "prompt"],
      link_relationship_type: [
        "references",
        "supports",
        "results_in",
        "related_to",
        "opposes",
        "informs",
        "derived_from",
      ],
      linkable_entity_type: [
        "asset_note",
        "portfolio_note",
        "theme_note",
        "custom_note",
        "asset",
        "portfolio",
        "theme",
        "trade_idea",
        "trade",
        "trade_sheet",
        "workflow",
        "project",
        "calendar_event",
        "user",
        "quick_thought",
        "trade_proposal",
        "trade_idea_thesis",
      ],
      min_lot_behavior: ["round", "zero", "warn"],
      note_type: [
        "meeting",
        "call",
        "research",
        "idea",
        "analysis",
        "general",
        "thesis_update",
        "earnings",
        "risk_review",
        "trade_rationale",
        "market_commentary",
        "thesis",
        "decision",
        "risk",
      ],
      notebook_type: ["asset", "theme", "portfolio", "custom"],
      notification_type: [
        "asset_field_change",
        "asset_priority_change",
        "asset_stage_change",
        "note_shared",
        "note_created",
        "price_target_change",
        "list_shared",
        "theme_shared",
        "workflow_shared",
        "mention",
        "workflow_invitation",
        "task_assigned",
        "stage_assigned",
        "workflow_access_request",
        "coverage_request",
        "project_assigned",
        "price_target_expired",
        "decision_nudge",
        "recommendation_submitted",
        "recommendation_decided",
        "simulation_shared",
        "accepted_trade_committed",
        "accepted_trade_status",
        "accepted_trade_comment",
        "trade_batch_status",
        "decision_request_resolved",
        "coverage_request_resolved",
        "coverage_added",
        "coverage_removed",
        "ai_rate_limit_hit",
        "ai_provider_error",
        "org_membership_added",
        "org_membership_status",
        "org_role_changed",
        "coverage_admin_changed",
      ],
      origin_entity_type: [
        "asset",
        "portfolio",
        "trade_lab",
        "view",
        "trade_idea",
      ],
      origin_type: [
        "asset_page",
        "portfolio_page",
        "trade_lab",
        "search",
        "dashboard",
        "manual",
        "counter_view",
      ],
      portfolio_decision_outcome: ["accepted", "deferred", "rejected"],
      price_target_type: ["bull", "base", "bear"],
      priority_level: [
        "high",
        "medium",
        "low",
        "none",
        "critical",
        "maintenance",
      ],
      process_stage: [
        "research",
        "analysis",
        "monitoring",
        "review",
        "archived",
        "outdated",
        "initiated",
        "prioritized",
        "in_progress",
        "recommend",
        "action",
        "none",
        "monitor",
      ],
      project_assignment_role: [
        "owner",
        "contributor",
        "reviewer",
        "lead",
        "collaborator",
      ],
      project_priority: ["low", "medium", "high", "urgent"],
      project_status: [
        "planning",
        "in_progress",
        "blocked",
        "completed",
        "cancelled",
      ],
      rationale_status: ["draft", "complete", "reviewed"],
      rationale_type: [
        "planned",
        "reactive",
        "execution_adjustment",
        "risk_management",
        "thesis_update",
        "other",
      ],
      revision_event_category: [
        "thesis",
        "where_different",
        "risks_to_thesis",
        "valuation_targets",
        "supporting",
      ],
      revision_view_scope: ["firm", "user"],
      simulation_permission: ["view", "comment", "edit", "admin"],
      simulation_share_access: ["view", "suggest", "collaborate"],
      simulation_share_mode: ["snapshot", "live"],
      simulation_status: ["draft", "running", "completed", "archived"],
      sizing_framework: [
        "weight_target",
        "weight_delta",
        "active_target",
        "active_delta",
        "shares_target",
        "shares_delta",
      ],
      tdf_trade_status: ["proposed", "approved", "executed", "cancelled"],
      theme_lifecycle_status: [
        "emerging",
        "active",
        "playing_out",
        "played_out",
        "invalidated",
      ],
      theme_type: ["sector", "geography", "strategy", "macro", "general"],
      thought_date_type: ["revisit", "alert", "expiration"],
      thought_sentiment: [
        "bullish",
        "bearish",
        "neutral",
        "curious",
        "concerned",
        "excited",
      ],
      thought_source_type: [
        "news_article",
        "headline",
        "research",
        "earnings",
        "price_move",
        "social_media",
        "conversation",
        "idea",
        "general",
        "other",
      ],
      thought_visibility: ["private", "team", "public", "organization"],
      trade_action: ["buy", "sell", "trim", "add"],
      trade_event_action: [
        "initiate",
        "add",
        "trim",
        "exit",
        "reduce",
        "cover",
        "short_initiate",
        "rebalance",
        "hedge",
        "other",
      ],
      trade_event_source: [
        "holdings_diff",
        "execution_import",
        "manual",
        "reconciliation",
      ],
      trade_event_status: [
        "pending_rationale",
        "draft_rationale",
        "complete",
        "reviewed",
        "ignored",
      ],
      trade_event_type: [
        "created",
        "proposal_created",
        "proposal_updated",
        "proposal_snapshot",
        "moved_to_deciding",
        "moved_to_simulating",
        "approved",
        "rejected",
        "executed",
        "sizing_changed",
        "note_added",
        "status_changed",
        "proposal_withdrawn",
      ],
      trade_lab_view_role: ["owner", "editor", "viewer"],
      trade_lab_view_type: ["private", "shared", "portfolio"],
      trade_outcome: ["executed", "rejected", "deferred"],
      trade_queue_status: [
        "idea",
        "discussing",
        "approved",
        "rejected",
        "executed",
        "cancelled",
        "deleted",
        "deciding",
        "simulating",
        "archived",
      ],
      trade_sheet_status: [
        "draft",
        "pending_approval",
        "approved",
        "sent_to_desk",
        "executed",
        "cancelled",
      ],
      trade_stage: [
        "idea",
        "discussing",
        "simulating",
        "deciding",
        "working_on",
        "modeling",
        "aware",
        "investigate",
        "deep_research",
        "thesis_forming",
        "ready_for_decision",
      ],
      visibility_tier: ["active", "trash", "archive"],
    },
  },
} as const
