create or replace package body pkg_payroll as
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  function calculate_mora(p_days in varchar2) return number is
  -- synthetic filler line (no proprietary content)
    l_bonus := pkg_employee.calculate_bonus(l_emp_id);
  -- synthetic filler line (no proprietary content)
    select amount into l_amount from employees where employee_id = l_emp_id;
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    l_total := count_employees();
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  procedure run_payroll is
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    l_mora := calculate_mora(p_days => l_days);
  -- synthetic filler line (no proprietary content)
    update departments set last_payroll_dt = sysdate;
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    pkg_legacy.run_unknown(l_amount);  -- legacy callee is UNRESOLVED
