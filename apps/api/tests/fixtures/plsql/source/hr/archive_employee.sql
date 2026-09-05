-- synthetic archive routine (fixture, no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
  procedure archive_employee(p_emp_id in number) is
  -- synthetic filler line (no proprietary content)
  -- synthetic filler line (no proprietary content)
    pkg_employee.create_employee(p_last_name => l_name);
    select * from employee_details where employee_id = p_emp_id;
