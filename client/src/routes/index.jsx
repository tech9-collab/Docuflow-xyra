import BankStatement from "../pages/BankStatement/BankStatement";
import Invoices from "../pages/Invoices/Invoices";
import Bills from "../pages/Bills/Bills";
import EmiratesId from "../pages/EmiratesId/EmiratesId";
import Passport from "../pages/Passport/Passport";
import Visa from "../pages/Visa/Visa";
import TradeLicense from "../pages/TradeLicense/TradeLicense";
import TableResultPage from "../pages/TableResultPage/TableResultPage";
import EmiratesResultPage from "../pages/EmiratesResultPage/EmiratesResultPage";
import PassportResultPage from "../pages/PassportResultPage/PassportResultPage";
import VisaResultPage from "../pages/VisaResultPage/VisaResultPage";
import BillsResultPage from "../pages/BillsResultPage/BillsResultPage";
import TradeLicenseResultPage from "../pages/TradeLicenseResulPage/TradeLicenseResultPage";
import InvoiceTable from "../pages/InvoiceTable/InvoiceTable";
import RolesPermissions from "../pages/RolesPermissions/RolesPermissionsSimple";
import AddRole from "../pages/RolesPermissions/AddRole";
import EmployeeManagement from "../pages/EmployeeManagement/EmployeeManagement";
import AddUser from "../pages/EmployeeManagement/AddUser";
import DepartmentManagement from "../pages/DepartmentManagement/DepartmentManagement";
import AddDepartment from "../pages/DepartmentManagement/AddDepartment";
import AdminDashboard from "../pages/AdminDashboard/AdminDashboard";
import DepartmentDashboard from "../pages/DepartmentDashboard/DepartmentDashboard";
import DepartmentUsers from "../pages/DepartmentUsers/DepartmentUsers";
import UserDashboard from "../pages/UserDashboard/UserDashboard";
import NotFound from "../pages/NotFound/NotFound";
import KnowledgeBase from "../pages/KnowledgeBase/KnowledgeBase";
import {
  PermissionRoute,
  AdminRoute,
} from "../components/PermissionRoute/PermissionRoute";
import RootRedirect from "./RootRedirect";
import { Shield } from "lucide-react";

// Import the new project module pages
import BookKeeping from "../pages/BookKeeping/BookKeeping";
import VatFiling from "../pages/VatFiling/VatFiling";
import CtFiling from "../pages/CtFiling/CtFiling";
import VatFilingPeriods from "../pages/VatFiling/VatFilingPeriods";
import CtFilingPeriods from "../pages/CtFiling/CtFilingPeriods";
import VatPeriodRuns from "../pages/VatFiling/VatPeriodRuns";

import Registration from "../pages/Registration/Registration";
import AuditReport from "../pages/AuditReport/AuditReport";
// Import BankAndInvoice page

import CtFilingTypes from "../pages/CtFilingTypes/CtFilingTypes";

import BankAndInvoice from "../pages/BankandInvoice/BankAndInvoice";
import VatFilingPreview from "../pages/VatFilingPreview/VatFilingPreview";

import CtBankOnly from "../pages/CtBankOnly/CtBankOnly";

import CtBankAndInvoice from "../pages/CtBankAndInvoice/CtBankAndInvoice";

import CtBankOnlyPreview from "../pages/CtBankOnlyPreview/CtBankOnlyPreview";

import CtBankAndInvoicePreview from "../pages/CtBankAndInvoicePreview/CtBankAndInvoicePreview";

import Customers from "../pages/Customers/Customers";

import AddCustomer from "../pages/Customers/AddCustomer";

import ViewCustomer from "../pages/Customers/ViewCustomer";

import EditCustomer from "../pages/Customers/EditCustomer";
import Companies from "../pages/Companies/Companies";
import TrnVerification from "../pages/TrnVerification/TrnVerification";
import CreatePayrollPayment from "../pages/Payroll/CreatePayrollPayment";

// Only the Converts submenu pages are routed.
const routes = [
  { path: "/", element: RootRedirect },
  {
    path: "/admin/companies",
    element: () => (
      <AdminRoute>
        <Companies />
      </AdminRoute>
    ),
  },
  {
    path: "/customers",
    element: () => (
      <PermissionRoute permission="customers.read">
        <Customers />
      </PermissionRoute>
    ),
  },
  {
    path: "/customers/create",
    element: () => (
      <PermissionRoute permission="customers.create">
        <AddCustomer />
      </PermissionRoute>
    ),
  }, // default to bank statement page instead of projects page
  {
    path: "/customers/:id",
    element: () => (
      <PermissionRoute permission="customers.read">
        <ViewCustomer />
      </PermissionRoute>
    ),
  },
  {
    path: "/customers/:id/edit",
    element: () => (
      <PermissionRoute permission="customers.update">
        <EditCustomer />
      </PermissionRoute>
    ),
  },

  {
    path: "/projects/vat-filing",
    element: () => (
      <PermissionRoute permission="projects.vat_filing">
        <VatFiling />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/vat-filing/periods/:customerId",
    element: () => (
      <PermissionRoute permission="projects.vat_filing">
        <VatFilingPeriods />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/vat-filing/periods/:customerId/runs/:periodId",
    element: () => (
      <PermissionRoute permission="projects.vat_filing">
        <VatPeriodRuns />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/ct-filing",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtFiling />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/ct-filing/periods/:customerId",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtFilingPeriods />
      </PermissionRoute>
    ),
  },


  {
    path: "/projects/vat-filing/bank-and-invoice/:companyId",
    element: () => (
      <PermissionRoute permission="projects.vat_filing">
        <BankAndInvoice />
      </PermissionRoute>
    ),
  },
  {
    path: "/vat-filing-preview/:companyId",
    element: () => (
      <PermissionRoute permission="projects.vat_filing">
        <VatFilingPreview />
      </PermissionRoute>
    ),
  },

  {
    path: "/projects/ct-filing/bank-and-invoice/:companyId",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtBankAndInvoice />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/ct-filing/types/:companyId",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtFilingTypes />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/ct-filing/bank-only/:companyId",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtBankOnly />
      </PermissionRoute>
    ),
  },
  {
    path: "/projects/ct-filing/bank-only/:companyId/preview",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtBankOnlyPreview />
      </PermissionRoute>
    ),
  },
  {
    path: "/ct-filing-preview/:companyId",
    element: () => (
      <PermissionRoute permission="projects.ct_filing">
        <CtBankAndInvoicePreview />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/bank-statement",
    element: () => (
      <PermissionRoute permission="converts.bank_statements">
        <BankStatement />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/bank-statement/tableresult",
    element: () => (
      <PermissionRoute permission="converts.bank_statements">
        <TableResultPage />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/invoices",
    element: () => (
      <PermissionRoute permission="converts.invoices">
        <Invoices />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/invoices/tableresult",
    element: () => (
      <PermissionRoute permission="converts.invoices">
        <InvoiceTable />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/trn-verification",
    element: () => (
      <PermissionRoute permission="converts.invoices">
        <TrnVerification />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/bills",
    element: () => (
      <PermissionRoute permission="converts.bills">
        <Bills />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/bills/tableresult",
    element: () => (
      <PermissionRoute permission="converts.bills">
        <BillsResultPage />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/emiratesid",
    element: () => (
      <PermissionRoute permission="converts.emirates_id">
        <EmiratesId />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/emiratesid/tableresult",
    element: () => (
      <PermissionRoute permission="converts.emirates_id">
        <EmiratesResultPage />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/passport",
    element: () => (
      <PermissionRoute permission="converts.passport">
        <Passport />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/passport/tableresult",
    element: () => (
      <PermissionRoute permission="converts.passport">
        <PassportResultPage />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/visa",
    element: () => (
      <PermissionRoute permission="converts.visa">
        <Visa />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/visa/tableresult",
    element: () => (
      <PermissionRoute permission="converts.visa">
        <VisaResultPage />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/tradelicense",
    element: () => (
      <PermissionRoute permission="converts.trade_license">
        <TradeLicense />
      </PermissionRoute>
    ),
  },
  {
    path: "/converts/tradelicense/tableresult",
    element: () => (
      <PermissionRoute permission="converts.trade_license">
        <TradeLicenseResultPage />
      </PermissionRoute>
    ),
  },
  // Admin routes
  {
    path: "/admin/dashboard",
    element: () => (
      <AdminRoute>
        <AdminDashboard />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/departments",
    element: () => (
      <AdminRoute>
        <DepartmentManagement />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/departments/create",
    element: () => (
      <AdminRoute>
        <AddDepartment />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/employees",
    element: () => (
      <AdminRoute>
        <EmployeeManagement />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/employees/create",
    element: () => (
      <AdminRoute>
        <AddUser />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/roles-permissions",
    element: () => (
      <AdminRoute>
        <RolesPermissions />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/roles-permissions/create",
    element: () => (
      <AdminRoute>
        <AddRole />
      </AdminRoute>
    ),
  },
  // Department admin routes
  {
    path: "/admin/department/:departmentId/dashboard",
    element: () => (
      <AdminRoute>
        <DepartmentDashboard />
      </AdminRoute>
    ),
  },
  {
    path: "/admin/department/:departmentId/users",
    element: () => (
      <AdminRoute>
        <DepartmentUsers />
      </AdminRoute>
    ),
  },
  // Payroll routes
  {
    path: "/admin/payroll/create",
    element: () => (
      <AdminRoute>
        <CreatePayrollPayment />
      </AdminRoute>
    ),
  },
  // User dashboard routes
  {
    path: "/dashboard",
    element: () => (
      <PermissionRoute permission="dashboard.read">
        <UserDashboard />
      </PermissionRoute>
    ),
  },
  {
    path: "/user/dashboard",
    element: () => (
      <PermissionRoute permission="dashboard.read">
        <UserDashboard />
      </PermissionRoute>
    ),
  },
  { path: "*", element: NotFound },
];

export default routes;
