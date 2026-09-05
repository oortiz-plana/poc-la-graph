create or replace view employee_details as
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  select e.employee_id, e.last_name,
  -- synthetic filler line (no proprietary content)
  from employees e
  left join departments d on d.department_id = e.department_id
