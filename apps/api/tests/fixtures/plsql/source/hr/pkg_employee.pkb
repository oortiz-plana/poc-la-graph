create or replace package body pkg_employee as
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  procedure create_employee(
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    insert into employees (employee_id, last_name)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    select max(department_id) from departments;
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  function calculate_bonus(p_salary in number) return number is
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    select salary into l_base from employees where employee_id = p_emp_id;
