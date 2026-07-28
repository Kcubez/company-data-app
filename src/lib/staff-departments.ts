export const STAFF_DEPARTMENTS = ["Sales", "IT", "Finance", "QA"] as const;

export function hasValidStaffDepartments(departments: unknown): departments is string[] {
  return (
    Array.isArray(departments) &&
    departments.length > 0 &&
    departments.every((department) =>
      STAFF_DEPARTMENTS.includes(department as (typeof STAFF_DEPARTMENTS)[number])
    )
  );
}
