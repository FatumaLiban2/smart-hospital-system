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
      consultations: {
        Row: {
          consulted_at: string
          consulted_by: string
          diagnosis: string | null
          examination_findings: string | null
          history_of_presenting_illness: string | null
          id: string
          patient_id: string
          presenting_complaint: string | null
          treatment_plan: string | null
          visit_id: string
        }
        Insert: {
          consulted_at?: string
          consulted_by: string
          diagnosis?: string | null
          examination_findings?: string | null
          history_of_presenting_illness?: string | null
          id?: string
          patient_id: string
          presenting_complaint?: string | null
          treatment_plan?: string | null
          visit_id: string
        }
        Update: {
          consulted_at?: string
          consulted_by?: string
          diagnosis?: string | null
          examination_findings?: string | null
          history_of_presenting_illness?: string | null
          id?: string
          patient_id?: string
          presenting_complaint?: string | null
          treatment_plan?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          category: string
          id: string
          medication_name: string
          reorder_level: number
          status: string
          stock_level: number
          unit: string
        }
        Insert: {
          category: string
          id?: string
          medication_name: string
          reorder_level?: number
          status?: string
          stock_level?: number
          unit?: string
        }
        Update: {
          category?: string
          id?: string
          medication_name?: string
          reorder_level?: number
          status?: string
          stock_level?: number
          unit?: string
        }
        Relationships: []
      }
      lab_requests: {
        Row: {
          consultation_id: string | null
          id: string
          lab_code: string
          patient_id: string
          requested_at: string
          requested_by: string
          status: string
          test_type: string
          visit_id: string
        }
        Insert: {
          consultation_id?: string | null
          id?: string
          lab_code?: string
          patient_id: string
          requested_at?: string
          requested_by: string
          status?: string
          test_type: string
          visit_id: string
        }
        Update: {
          consultation_id?: string | null
          id?: string
          lab_code?: string
          patient_id?: string
          requested_at?: string
          requested_by?: string
          status?: string
          test_type?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_requests_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_results: {
        Row: {
          id: string
          lab_request_id: string
          notes: string | null
          patient_id: string
          reference_range: string | null
          result_details: string
          result_status: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          id?: string
          lab_request_id: string
          notes?: string | null
          patient_id: string
          reference_range?: string | null
          result_details: string
          result_status: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          id?: string
          lab_request_id?: string
          notes?: string | null
          patient_id?: string
          reference_range?: string | null
          result_details?: string
          result_status?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_results_lab_request_id_fkey"
            columns: ["lab_request_id"]
            isOneToOne: false
            referencedRelation: "lab_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          date_of_birth: string
          first_name: string
          gender: string
          id: string
          insurance_number: string | null
          last_name: string
          patient_code: string
          phone_number: string
          registered_at: string
          registered_by: string
          visit_reason: string
        }
        Insert: {
          date_of_birth: string
          first_name: string
          gender: string
          id?: string
          insurance_number?: string | null
          last_name: string
          patient_code?: string
          phone_number: string
          registered_at?: string
          registered_by: string
          visit_reason: string
        }
        Update: {
          date_of_birth?: string
          first_name?: string
          gender?: string
          id?: string
          insurance_number?: string | null
          last_name?: string
          patient_code?: string
          phone_number?: string
          registered_at?: string
          registered_by?: string
          visit_reason?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          id: string
          insurance_provider: string | null
          method: string
          patient_id: string
          processed_at: string
          processed_by: string
          receipt_number: string
          status: string
          visit_id: string
        }
        Insert: {
          amount?: number
          id?: string
          insurance_provider?: string | null
          method: string
          patient_id: string
          processed_at?: string
          processed_by: string
          receipt_number?: string
          status?: string
          visit_id: string
        }
        Update: {
          amount?: number
          id?: string
          insurance_provider?: string | null
          method?: string
          patient_id?: string
          processed_at?: string
          processed_by?: string
          receipt_number?: string
          status?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          consultation_id: string | null
          dispensed: boolean
          dispensed_at: string | null
          dispensed_by: string | null
          id: string
          issued_at: string
          issued_by: string
          medications: Json
          notes: string | null
          patient_id: string
          rx_code: string
          visit_id: string
        }
        Insert: {
          consultation_id?: string | null
          dispensed?: boolean
          dispensed_at?: string | null
          dispensed_by?: string | null
          id?: string
          issued_at?: string
          issued_by: string
          medications?: Json
          notes?: string | null
          patient_id: string
          rx_code?: string
          visit_id: string
        }
        Update: {
          consultation_id?: string | null
          dispensed?: boolean
          dispensed_at?: string | null
          dispensed_by?: string | null
          id?: string
          issued_at?: string
          issued_by?: string
          medications?: Json
          notes?: string | null
          patient_id?: string
          rx_code?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          role: string
          staff_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          role: string
          staff_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          role?: string
          staff_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      triage_records: {
        Row: {
          blood_sugar: number | null
          bmi: number | null
          bp_diastolic: number | null
          bp_systolic: number | null
          chief_complaint: string | null
          height: number | null
          id: string
          oxygen_saturation: number | null
          patient_id: string
          priority: string
          pulse: number | null
          recorded_at: string
          recorded_by: string
          temperature: number | null
          visit_id: string
          weight: number | null
        }
        Insert: {
          blood_sugar?: number | null
          bmi?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          chief_complaint?: string | null
          height?: number | null
          id?: string
          oxygen_saturation?: number | null
          patient_id: string
          priority: string
          pulse?: number | null
          recorded_at?: string
          recorded_by: string
          temperature?: number | null
          visit_id: string
          weight?: number | null
        }
        Update: {
          blood_sugar?: number | null
          bmi?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          chief_complaint?: string | null
          height?: number | null
          id?: string
          oxygen_saturation?: number | null
          patient_id?: string
          priority?: string
          pulse?: number | null
          recorded_at?: string
          recorded_by?: string
          temperature?: number | null
          visit_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "triage_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_records_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          created_by: string
          id: string
          patient_id: string
          status: string
          visit_date: string
        }
        Insert: {
          created_by: string
          id?: string
          patient_id: string
          status?: string
          visit_date?: string
        }
        Update: {
          created_by?: string
          id?: string
          patient_id?: string
          status?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fmt_code: { Args: { n: number; prefix: string }; Returns: string }
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
